import { Processing } from "./Processing.js";
import { PJSResourceCache } from "./PJSResourceCache.js";
import { PJSCodeInjector } from "./PJSCodeInjector.js";


class KhanPJS {
    code = "";

    constructor(options) {
        this.canvas = options.canvas || document.createElement("canvas");
        this.DUMMY = function () { }
        this.processing = new Processing(this.canvas, instance => instance.draw = this.DUMMY);
        this.resourceCache = new PJSResourceCache({
            canvas: this.processing
        });

        this.infiniteLoopCallback = options.infiniteLoopCallback ?? function(error){};
        
        this.injector = new PJSCodeInjector({
            processing: this.processing,
            resourceCache: this.resourceCache,
            infiniteLoopCallback: this.infiniteLoopCallback.bind(this),
            enableLoopProtect: options.enableLoopProtect ?? true,
            additionalMethods: { Program: this.ProgramMethods },
            loopProtectTimeouts: { startupTimeout: options.startupTimeout, programTimeout: options.programTimeout, loopCheck: options.loopCheck }
        });

        this.prepProcessing();
        this.originalState = Object.assign({}, this.processing);
        this.originalEntries = Object.entries(this.originalState);
        this.resetGlobals();
    }

    prepProcessing() {
        this.processing.size(400, 400);
        this.processing.background(255, 255, 255);
        this.processing.frameRate(30);
        this.processing.angleMode = "degrees";
    }

    resetGlobals() {
        //FAR EASIER way to clear globals than the way khanacademy does it.

        for (var i = 0; i < this.originalEntries.length; i++) {
            this.processing[this.originalEntries[i][0]] = this.originalEntries[i][1];   //allowing refrences is intentional cuz khanacademy does it too except they do it by accident
        }
        var p = Object.keys(this.processing);
        for (i = 0; i < p.length; i++) {
            if (!this.originalState.hasOwnProperty(p[i])) { delete this.processing[p[i]]; }
        }
    }

    runCode(code, errorCallback) {
        this.code = code;
        return this.restart(errorCallback);
    }

    restart(errorCallback) {
        this.resetGlobals();
        this.injector.restart();
        try{
            this.injector.runCode(this.code, errorCallback);    //errorCallback in this is for error in promise
        }
        catch(e){
            errorCallback(e);   //normal throws
        }
    }

    size(width = 400, height = 400) {
        if (this.processing && (width !== this.processing.width || height !== this.processing.height)) {

            this.canvas.width = width;
            this.canvas.height = height;

            this.processing.size(width, height);

            this.restart();
        }
    }

    ProgramMethod = {
        settings: function () { return {}; },
        restart: function () { this.restart(); },
        assertEqual: function () { },
    }

    set enableLoopProtect(bool){ this.injector.enableLoopProtect = bool; }
    set startupTimeout(num){ this.injector.startupTimeout = num; }
    set programTimeout(num){ this.injector.programTimeout = num; }
    set loopCheck(num){ this.injector.loopCheck = num; }

    get enableLoopProtect(){ return this.injector.enableLoopProtect; }
    get startupTimeout(){ return this.injector.startupTimeout; }
    get programTimeout(){ return this.injector.programTimeout; }
    get loopCheck(){ return this.injector.loopCheck; }
}

window.KhanPJS = KhanPJS;

export { KhanPJS };