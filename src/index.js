'use strict';

import express from 'express';
import bodyParser from 'body-parser';
import memoryStore from './memory-store';
import { reqRateLimit, resRateLimit, creditsConsumer } from './rate-limit';
import memcachedStore from './memcached-store';
import pg from 'pg';
import multer from 'multer';
import blake from 'blakejs';
import { success, error } from './utils';
import R from 'ramda';
import pkg from '../package.json';

let store = memoryStore;
let app = express();
let port = process.env.PORT || 8082;
let pgConfig = pkg.pgConfig;
let pgPool = new pg.Pool(pgConfig);
let upload = multer({ storage: multer.memoryStorage() });

// app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(reqRateLimit({ store: memcachedStore }));
app.use(resRateLimit());

function resInternalError(res) {
    res.status(500).end();
}

function resBadRequest(res) {
    res.status(400).json({ message: 'Bad Request' });
}

function resNotFound(res) {
    res.status(404).json({ message: 'Not Found' });
}

function newImageItem(img) {
    let now = new Date();
    return new Promise((resolve, reject) => client.query('INSERT INTO images VALUES ($1, $2, $3, $4)', [
        // Buffer.from(img.id, 'hex'),
        img.hash,
        img.data,
        now,
        now
    ], (err, result) => err ? reject(err) : resolve(result)));
}

function newRelationItem(img) {
    return new Promise((resolve, reject) => client.query('INSERT INTO relations VALUES ($1, $2)', [
        // Buffer.from(img.id, 'hex'),
        img.hash,
        {
            peers: []
        }
    ], (err, result) => err ? reject(err) : resolve(result)));
}

app.route('/gifs')
    .get(creditsConsumer(async (req, res) => {
        try {
            let imgArray = [];
            //counting query
            if (req.query.count && req.query.count === 'true') {
                let imgCount = (await pgPool.query('SELECT COUNT(*) FROM images')).rows[0].count;
                res.setHeader('Total-Count', imgCount);
            }
            else if (req.query.id) {
                let result = await pgPool.query('SELECT * FROM images WHERE imgid = $1', [Buffer.from(req.query.id, 'hex')]);
                if (result.rowCount > 1) {
                    res.type('gif').send(result.rows[0].imgzip);
                    return;
                }
            }
            else {
                // let imgs = await pgPool.query('SELECT * FROM images');
                // imgArray = imgs.map(imgRowToJson);
            }
            res.json({ gifs: imgArray });
        }
        catch (err) {
            error(err.message);
            resInternalError(res);
        }
    }, 1))
    .post(creditsConsumer(async (req, res) => {
        let file = undefined;
        try {
            await new Promise((resolve, reject) => upload.single('image-data')(req, res, (err) => {
                if (err) reject(err);
                else resolve();
            }));
            file = req.file;
            if (!file || (file.mimetype != 'image/gif')) throw new Error(`no 'image-data' field`);
            //may other check here (height/width/size)
        }
        catch (err) {
            error(err.message);
            resBadRequest(res);
        }
        //insert into database
        try {
            let img = {
                hash: Buffer.from(blake.blake2b(file.buffer)),
                data: file.buffer
            };
            await client.query('BEGIN')
                .then(() => newImageItem(img))
                .then(() => newRelationItem(img))
                .catch(() => {
                    client.query('ROLLBACK');
                    throw new Error('inser new item failed');
                })
                .then(() => client.query('COMMIT'))
                .then(() => res.json({id: img.hash.toString('hex')}));
        }
        catch (err) {
            res.json({message: 'failed'})
        }
    }, 1));

app.route('/gifs/:nth')
    .get(creditsConsumer(async (req, res) => {
        let imgNth = 1 * req.params.nth;
        if (Number.isNaN(imgNth) || !(imgNth > 0)) {
            resBadRequest(res);
        }
        else {
            try {
                let result = await pgPool.query(`SELECT * FROM images LIMIT 1 OFFSET ${imgNth - 1}`);
                //request nth exceed records count
                if (result.rowCount != 1) {
                    resNotFound(res);
                }
                else {
                    // res.type('gif').send(result.rows[0].imgzip);
                    res.json({id: result.rows[0].imgid.toString('hex')});
                }
            }
            catch (err) {
                error(err.message);
                resInternalError(res);
            }
        }
    }, 1));

function isPeerExists(peerArray, newPeer) {
    R.any((peer) => peer.id === newPeer.id)(peerArray);
}

function addPeer(peerArray, newPeer) {
    peerArray.push({id: newPeer.id, hits: 1});
}

function updatePeer(peerArray, newPeer) {
    (R.find(R.propEq('id', newPeer.id))(peerArray)).hits++;
}

app.route('/relate')
    .all((req, res, next) => req.query.id ? next() : resBadRequest())
    .get(creditsConsumer(async (req, res) => {
        let imgId = req.query.id;
        try {
            let result = await pgPool.query('SELECT * FROM relations WHERE imgid = $1', [Buffer.from(imgId, 'hex')]);
            if (result.rowCount == 1) {
                let sumObj = result.rows[0].imgrel.peers.reduce((sum, peer) => ({ hits: sum.hits + peer.hits }), { hits: 0 });
                let peerPercent = result.rows[0].imgrel.peers.map((peer) => ({ id: peer.id, percent: (peer.hits / sumObj.hits) }));
                res.json({ peers: peerPercent });
            }
            else {
                res.json({ peers: [] });
            }
        }
        catch (err) {
            resInternalError(res);
        }
    }, 1))
    .put(creditsConsumer(async (req, res) => {
        if (!req.body.peers || !Array.isArray(req.body.peers)) {
            return resBadRequest(res);
        }
        let imgId = req.query.id;
        let imgPeers = req.body.peers;
        try {
            let result = await pgPool.query('SELECT * FROM relations WHERE imgid = $1', [Buffer.from(imgId, 'hex')]);
            if (result.rowCount == 1) {
                isPeerExists = isPeerExists.bind(null, result.rows[0].imgrel.peers);
                addPeer = addPeer.bind(null, result.rows[0].imgrel.peers);
                updatePeer = updatePeer.bind(null, result.rows[0].imgrel.peers);
                R.forEach((newPeer) => isPeerExists(newPeer) ? updatePeer(newPeer) : addPeer(newPeer), imgPeers);
                await pgPool.query('UPDATE relations SET imgrel = $1 WHERE imgid = $2', [result.rows[0].imgrel, Buffer.from(imgId, 'hex')]);
            }
            else {
                return resBadRequest(res);
            }
        }
        catch(err) {
            resInternalError(res);
        }
    }, 2));

app.listen(port);