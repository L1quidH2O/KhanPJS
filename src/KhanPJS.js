import { Processing } from "./Processing.js";
import { PJSResourceCache } from "./PJSResourceCache.js";
import { PJSCodeInjector } from "./PJSCodeInjector.js";


class KhanPJS {
    code = "";

    constructor(options = {}) {
        if (options.canvas) this.canvas = options.canvas;
        else {
            this.canvas = document.createElement("canvas");
            this.canvas.width = 400;
            this.canvas.height = 400;
        }
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
        this.processing.size(this.canvas.width, this.canvas.height);
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

    runCode(code = document.querySelector('script[type=pjs]')?.textContent, errorCallback = console.error) {
        this.code = code;
        return this.restart(errorCallback);
    }

    restart(errorCallback = console.error) {
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

            this.originalState.width = width;
            this.originalState.height = height;
            this.originalEntries.find(e=>e[0] === "width")[1] = width;
            this.originalEntries.find(e=>e[0] === "height")[1] = width;

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