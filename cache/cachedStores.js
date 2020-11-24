let stores = {};
const config = require("opendsu").loadApi("config");
const CacheMixin = require("../utils/PendingCallMixin");
const constants = require("../moduleConstants");

function IndexedDBCache(storeName, lifetime) {
    const self = this;
    CacheMixin(self);

    let db;
    let openRequest = indexedDB.open(storeName);
    openRequest.onsuccess = () => {
        db = openRequest.result;
        self.executePendingCalls();
        self.executeSerialPendingCalls();
    };

    openRequest.onupgradeneeded = () => {
        db = openRequest.result;
        db.createObjectStore(storeName);
    };

    self.get = (key, callback) => {
        if (typeof db === "undefined") {
            self.addPendingCall(() => {
                self.get(key, callback);
            });
        } else {
            let transaction = db.transaction(storeName, "readonly");
            const store = transaction.objectStore(storeName);
            let req = store.get(key);
            transaction.oncomplete = () => {
                if (typeof lifetime !== "undefined") {
                    const currentTime = Date.now();
                    const timestampedData = req.result;
                    if (typeof timestampedData === "undefined") {
                        return callback();
                    }
                    if (currentTime - timestampedData.timestamp > lifetime) {
                        self.delete(key);
                        return callback();
                    }
                    callback(undefined, timestampedData.value)
                } else {
                    callback(undefined, req.result);
                }
            }
        }
    };

    self.put = (key, value, callback) => {
        self.addSerialPendingCall((next) => {
            let transaction;
            let store
            try {
                transaction = db.transaction(storeName, "readwrite");
                store = transaction.objectStore(storeName);
            }catch (e) {
                callback(e);
                return next();
            }
            let data;
            if (typeof lifetime !== "undefined") {
                data = {
                    value: value,
                    timestamp: Date.now()
                }
            } else {
                data = value;
            }
            let req = store.put(data, key);
            transaction.oncomplete = () => {
                if (typeof callback === "function") {
                    callback(undefined, key);
                }
                next();
            }
            transaction.onabort = function() {
                console.log("Error", transaction.error);
            };
            req.onerror = function (event){
                next();
            }
        });
    };

    self.delete = (key, callback) => {
            self.addSerialPendingCall((next) => {
                let transaction;
                let store
                try {
                    transaction = db.transaction(storeName, "readwrite");
                    store = transaction.objectStore(storeName);
                }catch (e) {
                    callback(e);
                    next();
                    return;
                }
                let req = store.delete(key);
                transaction.oncomplete = () => {
                    if (typeof callback === "function") {
                        callback(undefined, key);
                    }
                    next();
                }
                transaction.onabort = function() {
                    console.log("Error", transaction.error);
                };
                req.onerror = function (event){
                    next();
                }
            });
    }
}

function FSCache(folderName) {
    const self = this;
    CacheMixin(self);
    const fsName = "fs";
    const fs = require(fsName);
    let baseFolder = config.get(constants.CACHE.BASE_FOLDER_CONFIG_PROPERTY);
    if (typeof baseFolder === "undefined") {
        baseFolder = process.cwd();
    }
    const path = require("swarmutils").path;
    const folderPath = path.join(baseFolder, folderName);
    let storageFolderIsCreated = false;
    fs.mkdir(folderPath, {recursive: true}, (err) => {
        if (err) {
            throw err;
        }

        storageFolderIsCreated = true;
    });

    self.get = function (key, callback) {
        if (!storageFolderIsCreated) {
            self.addPendingCall(() => {
                self.get(key, callback);
            })
        } else {
            fs.readFile(path.join(folderPath, key), (err, data) => {
                if (err) {
                    return callback(err);
                }

                let content = data;
                try {
                    content = JSON.parse(content.toString())
                } catch (e) {
                    return callback(data);
                }
                callback(undefined, content);
            });
        }
    };

    self.put = function (key, value, callback) {
        if (Array.isArray(value)) {
            value = JSON.stringify(value);
        }
        if (!storageFolderIsCreated) {
            self.addPendingCall(() => {
                self.put(key, value, callback);
            });
        } else {
            if (!callback) {
                callback = () => {
                };
            }
            fs.writeFile(path.join(folderPath, key), value, callback);
        }
    }
}

function getCache(storeName, lifetime) {
    if (typeof stores[storeName] === "undefined") {
        switch (config.get(constants.CACHE.VAULT_TYPE)) {
            case constants.CACHE.INDEXED_DB:
                stores[storeName] = new IndexedDBCache(storeName, lifetime);
                break;
            case constants.CACHE.FS:
                stores[storeName] = new FSCache(storeName);
                break;
            case constants.CACHE.NO_CACHE:
                break;
            default:
                throw Error("Invalid cache type");
        }
    }

    return stores[storeName];
}


module.exports = {
    getCache
}