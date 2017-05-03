'use strict';

let database = new Map();

let memoryStore = {
    set(key, value, expire) {
        return new Promise((resolve, reject) => {
            database.set(key, {
                data: value,
                bornOn: Date.now(),
                lifetime: expire
            });
            resolve();
        });
    },

    get(key) {
        return new Promise((resolve, reject) => database.has(key) ? resolve(database.get(key).data) : reject(new Error('NOT FOUND')));
    },

    renew(key, expire) {
        return new Promise((resolve, reject) => {
            if (!(expire > 0)) {
                return reject(new Error('INVALID ARG'));
            }
            let item = database.get(key);
            if (item) {
                item.bornOn = Date.now();
                item.lifetime = expire;
                resolve();
            }
            else {
                reject(new Error('NOT FOUND'));
            }
        });
    }
};

setInterval(() => {
    database.forEach((value, key) => {
        if (Date.now() > (value.bornOn + value.lifetime)) {
            database.delete(key);
        }
    }, database);
}, 1000).unref();

export default memoryStore;