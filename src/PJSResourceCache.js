import { ASTTransforms, walkAST } from "./AST";
// import * as esprima from "esprima";
import * as acorn from "acorn";

function PJSResourceCache(options) {
    this.canvas = options.canvas; // customized Processing instance
    this.cache = {};
    this.imageHolder = null;

    // Insert the images into a hidden div to cause them to load
    // but not be visible to the user
    if (!this.imageHolder) {
        this.imageHolder = document.createElement("div");
        this.imageHolder.style.height = 0;
        this.imageHolder.style.width = 0;
        this.imageHolder.style.overflow = "hidden";
        this.imageHolder.style.position = "absolute";
        document.body.appendChild(this.imageHolder);
    }
}

/**
 * Load and cache all resources (images and sounds) referenced in the code.
 *
 * All resources are loaded as we don't have more details on exactly which
 * images will be required.  Execution is delayed if a getImage/getSound call
 * is encountered in the source code and none of the resources have been loaded
 * yet.  Execution begins once all the resources have loaded.
 *
 * @param {Object} resources A object whose keys are filenames
 * @returns {Promise}
 */
PJSResourceCache.prototype.cacheResources = function (resources) {
    var _this = this;

    var promises = Object.keys(resources).map(function (filename) {
        return _this.loadResource(filename);
    });
    return Promise.all(promises);
};

PJSResourceCache.prototype.loadResource = function (filename) {
    if (filename.endsWith(".png")) {
        return this.loadImage(filename);
    } else if (filename.endsWith(".mp3")) {
        return this.loadSound(filename);
    }
};

PJSResourceCache.prototype.loadImage = function (filename) {
    var _this2 = this;

    return new Promise(function (resolve) {
        var img = document.createElement("img");

        img.onload = function () {
            _this2.cache[filename] = img;
            resolve();
        };
        img.onerror = function () {
            resolve(); // always resolve
        };

        img.src = /^(http:|https:)\/\//.test(filename) ? filename : "https://www.kasandbox.org/programming-images/" + filename;
        _this2.imageHolder.appendChild(img);
    });
};

PJSResourceCache.prototype.loadSound = function (filename) {
    var _this3 = this;

    return new Promise(function (resolve) {
        var audio = document.createElement("audio");
        var parts = filename.split("/");

        var group = OutputSounds[0].groups.find(value => { if (value[groupName] !== parts[0]) { return false; } return true; }) //_findWhere()
        var hasSound = group && group.sounds.includes(parts[1].replace(".mp3", ""));
        if (!hasSound) {
            resolve();
            return;
        }

        audio.preload = "auto";
        audio.oncanplaythrough = function () {
            _this3.cache[filename] = {
                audio: audio,
                __id: function __id() {
                    return "getSound('" + filename.replace(".mp3", "") + "')";
                }
            };
            resolve();
        };
        audio.onerror = function () {
            resolve();
        };

        audio.src = /^(http:|https:)\/\//.test(filename) ? filename : "https://cdn.kastatic.org/third_party/javascript-khansrc/live-editor/sounds/" + filename;
    });
};

PJSResourceCache.prototype.getResource = function (filename, type) {
    switch (type) {
        case "image":
            return this.getImage(filename);
        case "sound":
            return this.getSound(filename);
        default:
            throw "we can't load '" + type + "' resources yet";
    }
};

PJSResourceCache.prototype.getImage = function (filename) {
    var image = this.cache[filename + ".png"];

    if (!image) {
        throw "Image " + filename + " was not found.";
    }

    // cache <img> instead of PImage until we investigate how caching
    // PImage instances affects loadPixels(), pixels[], updatePixels()
    var pImage = new this.canvas.PImage(image);
    pImage.__id = function () {
        return "getImage('" + filename + "')";
    };

    return pImage;
};

PJSResourceCache.prototype.getSound = function (filename) {
    var sound = this.cache[filename + ".mp3"];

    if (!sound) {
        throw "Sound " + filename + " was not found.";
    }

    return sound;
};

/**
 * Searches for strings containing the name of any image or sound we providefor
 * users and adds them to `resources` as a key.
 *
 * @param {string} code
 * @returns {Object}
 */
PJSResourceCache.findResources = function (code) {
    var ast = acorn.parse(code, { ecmaVersion: "latest", locations: true });

    var resources = {};
    walkAST(ast, null, [ASTTransforms.findResources(resources)]);

    return resources;
};

export { PJSResourceCache };