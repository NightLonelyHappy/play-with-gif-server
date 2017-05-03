'use strict';

import Memcached from 'memcached';

let database = new Memcached('172.27.20.17:11211', {
    compressionThreshold: 1048576 //test this option
});

let memcachedStore = {
    set(key, value, expire) {
        return new Promise((resolve, reject) => {
            database.set(key, value, expire / 1000, (err, result) => {
                if (err) reject(err);
                else {
                    // console.log(result);
                    resolve(result);
                }
            });
        });
    },
    get(key) {
        return new Promise((resolve, reject) => {
            database.get(key, (err, data) => {
                if (err) {
                    return reject(err);
                }
                if (data) {
                    // console.log('memcached set');
                    resolve(data);
                }
                else reject(new Error('NOT FOUND'));
            })
        });
    },
    renew(key, expire) {
        return new Promise((resolve, reject) => {
            memcached.touch(key, expire / 1000, (err, result) => {
                if (err) reject(err);
                else {
                    console.log(result);
                    resolve(result);
                }
            });
        });
    },
    shutDown() {
        database.end();
    }
};

export default memcachedStore;