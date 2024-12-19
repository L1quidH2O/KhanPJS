import { ASTTransforms, ASTBuilder, walkAST } from "./AST";
import { PJSResourceCache } from "./PJSResourceCache";
import * as esprima from "esprima";
import escodegen from "escodegen";

var PJSUtils = {
    /**
     * Returns code contained within a function.
     *
     * @param {Function} func
     * @returns {string}
     */
    codeFromFunction(func) {
        var code = func.toString();
        code = code.substr(code.indexOf("{") + 1);
        return code.substr(0, code.length - 1);
    },

    /**
     * Removes excess indentation from code.
     *
     * @param {string} code
     * @returns {string}
     */
    cleanupCode(code) {
        var lines = code.split("\n").filter(function(line) {
            return line !== "";
        });

        var indent = lines[0].length - lines[0].trim().length;

        return lines.map(function(line) {
            return line.substring(indent);
        }).join("\n").trim();
    }
};

//based on underscore.js functions
var _each = function (obj, iterator) {
    if (obj == null) return;
    if (Array.isArray(obj)) {
        obj.forEach(iterator);
    }
    else {
        for (var key in obj) {
            iterator(obj[key], key, obj)
        }
    }
}
var _findWhere = function (obj, attrs) {
    // if (_.isEmpty(attrs)) return first ? null : [];
    return obj.find(value => {
        for (var key in attrs) {
            if (attrs[key] !== value[key]) return false;
        }
        return true;
    })
}


/**
 * Creates a new LoopProtector object.
 *
 * @param callback: called whenever a loop takes more than <timeout>ms to complete.
 * @param timeouts: an object containing initialTimeout and frameTimeout used
 *                  to control how long before the loop protector is triggered
 *                  on initial run during draw functions (or when responding to
 *                  user events)
 * @param reportLocation: true if the location of the long running loop should be
 *                        passed to the callback. TODO(kevinb) use this for webpages
 * @constructor
**/
class LoopProtector {
    constructor(callback, timeouts, reportLocation) {

        this.callback = callback || function () { };
        this.timeout = 1000; //:)   changed from 200 to 1000
        this.branchStartTime = 0;
        this.loopCounts = {};
        this.reportLocation = reportLocation;

        //this.loopBreak = esprima.parse("KAInfiniteLoopProtect()").body[0]
        this.loopBreak = {
            "type": "ExpressionStatement",
            "expression": {
                "type": "CallExpression",
                "callee": {
                    "type": "Identifier",
                    "name": "KAInfiniteLoopProtect"
                },
                "arguments": []
            }
        };

        if (timeouts) {
            this.startupTimeout = timeouts.startupTimeout ?? 2000;
            this.programTimeout = timeouts.programTimeout ?? 500;
            this.loopCheck = timeouts.loopCheck ?? 1000;
        }

        this.KAInfiniteLoopProtect = this._KAInfiniteLoopProtect.bind(this);
        this.KAInfiniteLoopSetTimeout = this._KAInfiniteLoopSetTimeout.bind(this);

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                this.visible = true;
                this.branchStartTime = 0;
            } else {
                this.visible = false;
            }
        });

        this.visible = !document.hidden;
    }

    /**
     * Throws 'KA_INFINITE_LOOP' if the difference between the current time
     * and this.brancStartTime is greater than this.timeout.
     *
     * The difference grows as long as this method is called synchronously.  As
     * soon as the current execution stack completes and the browser grabs the
     * next task off the event queue this.branchStartTime will be reset by the
     * timeout.
     *
     * In order to use this correctly, you must add a reference to this function
     * to the global scope where the user code is being run.  See the exec()
     * method in pjs-output.js for an example of how to do this.
     *
     * @private
    **/
    _KAInfiniteLoopProtect(location) {

        if (location) {
            if (!this.loopCounts[location]) {
                this.loopCounts[location] = 0;
            }
            this.loopCounts[location] += 1;
        }
        var now = Date.now();
        if (!this.branchStartTime) {
            this.branchStartTime = now;
            setTimeout(()=>this.branchStartTime = 0, 0);
        }
        else if (this.visible && now - this.branchStartTime > this.timeout) {
            if (!this.reportLocation) {
                var _error = new Error("KA_INFINITE_LOOP");
                this.callback(_error);
                throw _error;
            }

            // Determine which of KAInfiniteLoopProtect's callsites has
            // the most calls.
            var max = 0; // current max count
            var hotLocation = null; // callsite with most calls
            Object.keys(this.loopCounts).forEach(location=>{
                if (this.loopCounts[location] > max) {
                    max = this.loopCounts[location];
                    hotLocation = location;
                }
            });

            hotLocation = JSON.parse(hotLocation);

            var error = {
                infiniteLoopNodeType: hotLocation.type,
                row: hotLocation.loc.start.line - 1 // ace uses 0-indexed rows
            };

            this.callback(error);

            // We throw here to interrupt communication but also to
            throw error;
        }
    }

    _KAInfiniteLoopSetTimeout(timeout) {
        this.timeout = timeout;
        this.branchStartTime = 0;
    }

    riskyStatements = ["DoWhileStatement", "WhileStatement", "ForStatement", "FunctionExpression", "FunctionDeclaration", "ArrowFunctionExpression"]

    /**
     * Called by walkAST whenever it leaves a node so AST mutations are okay
    **/
    leave(node) {

        var b = ASTBuilder;

        if (this.riskyStatements.indexOf(node.type) !== -1) {
            if (this.reportLocation) {
                var _location = {
                    type: node.type,
                    loc: node.loc
                };

                // Inserts the following code at the start of riskt statements:
                //
                // KAInfiniteLoopCount++;
                // if (KAInfiniteLoopCount > 1000) {
                //     KAInfiniteLoopProtect();
                //     KAInfiniteLoopCount = 0;
                // }
                node.body.body.unshift(b.IfStatement(b.BinaryExpression(b.Identifier("KAInfiniteLoopCount"), ">", b.Literal(this.loopCheck)), b.BlockStatement([b.ExpressionStatement(b.CallExpression(b.Identifier("KAInfiniteLoopProtect"), [b.Literal(JSON.stringify(_location))])), b.ExpressionStatement(b.AssignmentExpression(b.Identifier("KAInfiniteLoopCount"), "=", b.Literal(0)))])));
                node.body.body.unshift(b.ExpressionStatement(b.UpdateExpression(b.Identifier("KAInfiniteLoopCount"), "++", false)));
            } else {
                node.body.body.unshift(this.loopBreak);
            }
        }

        if (node.type === "Program") {
            // Many pjs programs take a while to start up because they're generating
            // terrain or textures or whatever.  Instead of complaining about all of
            // those programs taking too long, we allow the main program body to take
            // a little longer to run.  We call KAInfiniteLoopSetTimeout and set
            // the timeout to startupTimeout just to reset the value when the program
            // is re-run.
            if (this.startupTimeout) {
                node.body.unshift(b.ExpressionStatement(b.CallExpression(b.Identifier("KAInfiniteLoopSetTimeout"), [b.Literal(this.startupTimeout)])));
            }

            // Any asynchronous calls such as mouseClicked() or calls to draw()
            // should take much less time so that the app (and the browser) remain
            // responsive as the app is running so we call KAInfiniteLoopSetTimeout
            // at the end of main and set timeout to be programTimeout
            if (this.programTimeout) {
                node.body.push(b.ExpressionStatement(b.CallExpression(b.Identifier("KAInfiniteLoopSetTimeout"), [b.Literal(this.programTimeout)])));
            }
        }
    }
}


/**
 * The CodeInjector object is responsible for running code, determining what
 * code to inject when the user code has been updated, and maintaining the
 * appropriate state in the processing object in order to make live editing
 * of processing-js programs work correctly.
**/
class PJSCodeInjector {

    /**
     * Create a new processing-js code injector.
     *
     * @param {Object} options
     * - processing: A Processing instance.
     * - resourceCache: A ResourceCache instance.
     * - infiniteLoopCallback: A function that's when the loop protector is
     *   triggered.
     * - enabledLoopProtect: When true, loop protection code is injected.
     * - loopProtectTimeouts: An object defining initialTimeout and
     *   frameTimeout, see loop-protect.js for details.
     * - additionalMethods: An object containing methods that will be added
     *   to the Processing instance.
     * - [sandboxed] A boolean specifying whether we're in the PJS sandbox or
     *   this is an official CS program we're compiling for a read-only
     *   environment.  Default is true.
     * - [envName] All references to global symbols, e.g. fill(...), draw, etc.
     *   are prefixed with this string which defaults to  "__env__".
    **/
    constructor(options) {

        var defaultOptions = {
            sandboxed: true,
            envName: "__env__"
        };

        Object.assign(this, defaultOptions, options);
        this.DUMMY = this.processing.draw; // initially draw is a DUMMY method
        this.seed = null;
        this.globals = {};

        var _this = this;

        if (this.sandboxed) {
            this.processing.Object = window.Object;
            this.processing.RegExp = window.RegExp;
            this.processing.Math = window.Math;
            this.processing.Array = window.Array;
            this.processing.String = window.String;
            this.processing.isNaN = window.isNaN;
            this.processing.Number = window.Number;
            this.processing.Date = window.Date;
        }

        Object.assign(this.processing, {
            getImage: function getImage(filename) {
                return _this.resourceCache.getImage(filename);
            },

            getSound: function getSound(filename) {
                return _this.resourceCache.getSound(filename);
            },

            playSound: function playSound(sound) {
                if (sound && sound.audio && sound.audio.play) {
                    sound.audio.currentTime = 0;
                    sound.audio.play();
                }
                else {
                    throw "No sound file provided.";
                }
            },

            // Basic console logging
            debug: function debug() {
                console.log.apply(console, arguments);
            }
        }, this.additionalMethods);

        this.reseedRandom();

        // Methods that trigger the draw loop
        this.drawLoopMethods = ["draw", "mouseClicked", "mouseDragged", "mouseMoved", "mousePressed", "mouseReleased", "mouseScrolled", "mouseOver", "mouseOut", "touchStart", "touchEnd", "touchMove", "touchCancel", "keyPressed", "keyReleased", "keyTyped"];

        // During live coding all of the following state must be reset
        // when it's no longer used.
        this.liveReset = {
            background: [255, 255, 255],
            colorMode: [1],
            ellipseMode: [3],
            fill: [255, 255, 255],
            frameRate: [60],
            imageMode: [0],
            rectMode: [0],
            stroke: [0, 0, 0],
            strokeCap: ["round"],
            strokeWeight: [1],
            textAlign: [37, 0],
            textAscent: [9],
            textDescent: [12],
            textFont: ["Arial", 12],
            textLeading: [14],
            textSize: [12]
        };

        /**
         * PJS calls which are known to produce no side effects when
         * called multiple times.
         * It's a good idea to add things here for functions that have
         * return values, but still call other PJS functions. In that
         * exact case, we detect that the function is not safe, but it
         * should indeed be safe.  So add it here! :)
         */
        this.idempotentCalls = ["createFont"];

        this.loopProtector = new LoopProtector(this.infiniteLoopCallback, this.loopProtectTimeouts, true);

    }

    /**
     * Collects a list of props and safeCalls from this.processing.
     * [REMOVED]
    **/
    initializeProps() {}

    /**
     * Restores the random seed to that saved seed value.
    **/
    restoreRandomSeed() {
        this.processing.randomSeed(this.seed);
    }

    /**
     * Generate a new random seed value and save it.
    **/
    reseedRandom() {
        this.seed = Math.floor(Math.random() * 4294967296);
    }

    /**
     * Resets the canvas.
     *
     * See liveReset for a list methods it calls and the values that resets.
    **/
    clear() {
        var _this2 = this;

        Object.keys(this.liveReset).forEach(function (prop) {
            _this2.processing[prop].apply(_this2.processing, _this2.liveReset[prop]);
        });
    }

    /**
     * Restarts the user's program.
    **/
    restart() {
        this.lastGrab = null;
        this.lastGrabObj = null;

        // Grab a new random seed
        this.reseedRandom();

        // Reset frameCount variable on restart
        this.processing.frameCount = 0;

        // Clear Processing logs
        this.processing._clearLogs();
    }

    /**
     * Generate a string list of properties.
     *
     * @param {Object} props
     * @returns {string}
     * 
     * [REMOVED]
    **/
    propListString(props) {return "";}

    /**
     * Lints user code.
     *
     * @param {string} userCode: code to lint
     * @param {boolean} skip: skips linting if true and resolves Deferred immediately
     * @returns {Promise} resolves an array of lint errors
     * 
     * [NEVER USED]
    **/
    lint() {return Promise.resolve();}

    /**
     * Extracts globals from the data return from the jshint and stores them
     * in this.globals.  Used in runCode, hasOrHadDrawLoop, and injectCode.
     *
     * @param {Object} hintData: an object containing JSHINT.data after
     *                 jshint-worker.js runs JSHINT(userCode).
     * @returns {Object} An object containing all of the globals as keys.
     * 
     * [NEVER USED]
    **/
    extractGlobals(hintData) {return {};}

    /**
     * Extract an object's properties for dynamic insertion.
     *
     * @param {string} name The name of the property to extract.
     * @param {Object} obj Object to extract properties from.
     * @param {string} [proto] Name of a property on the object to use instead of
     *        of the object itself.
    **/
    objectExtract(name, obj, proto) {
        // Make sure the object actually exists before we try
        // to inject stuff into it
        if (!this.processing[name]) {
            if (Array.isArray(obj)) {
                this.processing[name] = [];
            } else if (typeof obj === "function") {
                this.processing[name] = function () { };
            } else {
                this.processing[name] = {};
            }
        }

        // A specific property to inspect of the object
        // (which will probably be the .prototype)
        if (proto) {
            obj = obj[proto];
        }

        // Go through each property of the object
        for (var objProp in obj) {
            // Make sure the property is actually on the object and that
            // it isn't a "private" property (e.g. __name or __id)
            if (obj.hasOwnProperty(objProp) && objProp.indexOf("__") < 0) {
                // Turn the result of the extracted function into
                // a nicely-formatted string (maintains the closure)
                if (typeof obj[objProp] === "function") {
                    this.grabObj[name + (proto ? "." + proto : "") + "['" + objProp + "']"] = PJSCodeInjector.stringify(obj[objProp]);

                    // Otherwise we should probably just inject the value directly
                } else {
                    // Get the object that we'll be injecting into
                    var outputObj = this.processing[name];

                    if (proto) {
                        outputObj = outputObj[proto];
                    }

                    // Inject the object
                    outputObj[objProp] = obj[objProp];
                }
            }
        }
    }

    /**
     * Checks to see if a draw loop-introducing method currently
     * exists, or did exist, in the user's program.
    **/
    hasOrHadDrawLoop() {
        for (var i = 0, l = this.drawLoopMethods.length; i < l; i++) {
            var name = this.drawLoopMethods[i];
            if (this.globals[name] || this.lastGrab && this.lastGrab[name]) {
                return true;
            }
        }

        return false;
    }

    /**
     * Checks to see if a draw loop method is currently defined in the
     * user's program (defined is equivalent to !undefined or if it's
     * just a stub program.)
    */
    drawLoopMethodDefined() {
        for (var i = 0, l = this.drawLoopMethods.length; i < l; i++) {
            var name = this.drawLoopMethods[i];
            if (this.processing[name] !== this.DUMMY && this.processing[name] !== undefined) {
                return true;
            }
        }

        return false;
    }

    runCode(userCode, errorCallback) {
        var resources = PJSResourceCache.findResources(userCode);
        this.resourceCache.cacheResources(resources).then(() => this.injectCode(userCode)).catch(e=>{
            if(errorCallback){ errorCallback(e) }
        });
    }

    /**
     * Injects code into the live Processing.js execution.
     *
     * The first time the code is injected, or if no draw loop exists, all of
     * the code is just executed normally using .exec().
     *
     * For all subsequent injections the following workflow takes place:
     *   - The code is executed but with all functions that have side effects
     *     replaced with empty function placeholders.
     *     - During this execution a context is set (wrapping the code with a
     *       with(){...}) that intentionally gobbles up all globally-exposed
     *       variables that the user has defined. For example, this code:
     *       var x = 10, y = 20; will result in a grabAll object of:
     *       {"x":10,"y":20}. Only user defined variables are captured.
     *     - Additionally all calls to side effect-inducing functions are logged
     *       for later to the fnCalls array (this includes a log of the function
     *       name and its arguments).
     *   - When the injection occurs a number of pieces need to be inserted into
     *     the live code.
     *     - First, all side effect-inducing function calls are re-run. For
     *       example a call to background(0, 0, 0); will result in the code
     *       background(0, 0, 0); being run again.
     *     - Second any new, or changed, variables will be re-inserted. Given
     *       the x/y example from above, let's say the user changes y to 30,
     *       thus the following code will be executed: var y = 30;
     *     - Third, any variables that existed on the last run of the code but
     *       no longer exist will be deleted. For example, if the ", y = 20" was
     *       removed from the above example the following would be executed:
     *       "delete y;" If the draw function was deleted then the output will
     *       need to be cleared/reset as well.
     *     - Finally, if any draw state was reset to the default from the last
     *       inject to now (for example there use to be a 'background(0, 0, 0);'
     *       but now there is none) then we'll need to reset that draw state to
     *       the default.
     *   - All of these pieces of injected code are collected together and are
     *     executed in the context of the live Processing.js environment.
     *
     * @param {string} userCode
     * @param {Function} callback
    **/
    injectCode(userCode) {
        var _this5 = this;

        // Holds all the global variables extracted from the user's code
        var grabAll = {};

        // Holds all the function calls that came from function calls that
        // have side effects
        var fnCalls = [];

        // Holds rendered code for each of the calls in fnCalls
        var mutatingCalls = [];

        // Is true if the code needs to be completely re-run
        // This is true when instantiated objects that need
        // to be reinitialized.
        var rerun = false;

        // Keep track of which function properties need to be
        // reinitialized after the constructor has been changed
        var reinit = {};

        // A map of all global constructors (used for later
        // reinitialization of instances upon a constructor change)
        var constructors = {};

        // The properties exposed by the Processing.js object
        var externalProps = this.props;

        // The code string to inject into the live execution
        var inject = "";

        // Grab all object properties and prototype properties from
        // all objects and function prototypes
        this.grabObj = {};

        // Extract a list of instances that were created using applyInstance
        PJSCodeInjector.instances = [];

        // If we have a draw function then we need to do injection
        // If we had a draw function then we still need to do injection
        // to clean up any live variables.
        var hasOrHadDrawLoop = this.hasOrHadDrawLoop();

        // Only do the injection if we have or had a draw loop
        if (hasOrHadDrawLoop) {
            // Go through all the globally-defined variables (this is
            // determined by a prior run-through using JSHINT) and ensure that
            // they're all defined on a single context. Also make sure that any
            // function calls that have side effects are instead replaced with
            // placeholders that collect a list of all functions called and
            // their arguments.
            // TODO(jeresig): See if we can move this off into the worker
            // thread to save an execution.
            _each(this.globals, (function (val, global) {
                var value = this.processing[global];
                // Expose all the global values, if they already exist although
                // even if they are undefined, the result will still get sucked
                // into grabAll) Replace functions that have side effects with
                // placeholders (for later execution)
                grabAll[global] = typeof value === "function" && !this.safeCalls[global] ? function () {
                    if (typeof fnCalls !== "undefined") {
                        fnCalls.push([global, arguments]);
                    }
                    return 0;
                } : value;
            }).bind(this));

            // Run the code with the grabAll context. The code is run with no
            // side effects and instead all function calls and globally-defined
            // variable values are extracted. Abort injection on a runtime
            // error.
            var error = this.exec(userCode, grabAll);
            if (error) { throw error; }

            // Attach names to all functions
            _each(grabAll, function (val, prop) {
                if (typeof val === "function") {
                    val.__name = prop;
                }
            });

            // Keep track of all the constructor functions that may
            // have to be reinitialized
            for (var i = 0, l = PJSCodeInjector.instances.length; i < l; i++) {
                constructors[PJSCodeInjector.instances[i].constructor.__name] = true;
            }

            // The instantiated instances have changed, which means that
            // we need to re-run everything.
            if (this.oldInstances && PJSCodeInjector.stringifyArray(this.oldInstances) !== PJSCodeInjector.stringifyArray(PJSCodeInjector.instances)) {
                rerun = true;
            }

            // TODO(kevinb) cache instances returned by createGraphics.
            // Rerun if there are any uses of createGraphics.  The problem is
            // not actually createGraphics, but rather calls that render stuff
            // to the Processing instances returned by createGraphics.  In the
            // future we might be able to reuse these instances, but we'd need
            // to track which call to createGraphics returned which instance.
            // Using the arguments as an id is insufficient.  We'd have to use
            // some combination of which line number createGraphics was called
            // on whether it was the first call, second call, etc. that created
            // it to deal with loops.  We'd also need to take into account edit
            // operations that add/remove lines so that we could update the
            // line number in the id to avoid unnecessary reruns.  After all of
            // that we'll still have to fall back to rerun in all other cases.
            if (/createGraphics[\s\n]*\(/.test(userCode)) {
                rerun = true;
            }

            // Reset the instances list
            this.oldInstances = PJSCodeInjector.instances;
            PJSCodeInjector.instances = [];

            var _loop = function (i) {
                // Reconstruction the function call
                args = Array.prototype.slice.call(fnCalls[i][1]);
                results = args.map(function (arg, argIndex) {
                    // Parameters here can come in the form of objects.
                    // For any object parameter, we don't want to serialize it
                    // because we'd lose the whole prototype chain.
                    // Instead we create temporary variables for each.
                    if (!Array.isArray(arg) && arg === Object(arg)) {
                        var varName = "__obj__" + fnCalls[i][0] + "__" + argIndex;
                        _this5.processing[varName] = arg;
                        return varName;
                    } else {
                        return PJSCodeInjector.stringify(arg);
                    }
                });

                mutatingCalls.push(fnCalls[i][0] + "(" + results.join(", ") + ");");
            };

            // Look for new top-level function calls to inject
            for (var i = 0; i < fnCalls.length; i++) {
                var args;
                var results;

                _loop(i);
            }

            // We also look for newly-changed global variables to inject
            _each(grabAll, (function (val, prop) {
                // Ignore KAInfiniteLoop functions.
                if (/^KAInfiniteLoop/.test(prop)) {
                    return;
                }

                // Ignore PJSCodeInjector so that we can still access 'test', 'lint'
                // and other methods in our tests.
                if (/^PJSCodeInjector/.test(prop)) {
                    return;
                }

                // Turn the result of the extracted value into
                // a nicely-formatted string
                try {
                    grabAll[prop] = PJSCodeInjector.stringify(grabAll[prop]);

                    // Check to see that we've done an inject before and that
                    // the property wasn't one that shouldn't have been
                    // overridden, and that either the property wasn't in the
                    // last extraction or that the value of the property has
                    // changed.
                    if (this.lastGrab && externalProps[prop] !== false && (!(prop in this.lastGrab) || grabAll[prop] !== this.lastGrab[prop])) {

                        // If we hit a function we need to re-execute the code
                        // by injecting it. Preserves the closure.
                        if (typeof val === "function") {
                            // If the constructor function was changed and an
                            // instance of the function exists, then we need to
                            // re-run all the code from start
                            if (constructors[prop]) {
                                rerun = true;
                            }

                            // Remember that this function has been
                            // reinitialized for later (in case it has
                            // properties that need to be re-injected)
                            reinit[prop] = true;

                            inject += "var " + prop + " = " + grabAll[prop] + ";\n";

                            // Give the function a name as well
                            inject += prop + ".__name = '" + prop + "';\n";

                            // Otherwise it's ok to inject it directly into the
                            // new environment
                        } else {
                            // If we have an object, then copy over all of the
                            // properties so we don't accidentally destroy
                            // function scope from `with()` and closures on the
                            // object prototypes.
                            // TODO(bbondy): This may copy over things that
                            // were deleted. If we ever run into a problematic
                            // program, we may want to add support here.
                            if (!Array.isArray(val) && val === Object(val) && !Array.isArray(this.processing[prop]) && this.processing[prop] === Object(this.processing[prop])) {
                                // Copy over all of the properties
                                for (var p in val) {
                                    if (val.hasOwnProperty(p)) {
                                        this.processing[prop][p] = val[p];
                                    }
                                }
                            } else {
                                this.processing[prop] = val;
                            }
                        }
                    }

                    // For each function we also need to make sure that we
                    // extract all of the object and prototype properties
                    // (Since they won't be detected normally)
                    if (typeof val === "function" && externalProps[prop] !== false) {
                        this.objectExtract(prop, val);
                        this.objectExtract(prop, val, "prototype");
                    }

                    // The variable contains something that can't be serialized
                    // (such as instantiated objects) and so we need to extract it
                } catch (e) {
                    this.objectExtract(prop, val);
                }
            }).bind(this));

            // Insertion of new object properties or methods on a prototype
            _each(this.grabObj, (function (val, objProp) {
                var baseName = /^[^.[]*/.exec(objProp)[0];

                // If we haven't done an extraction before or if the value
                // has changed, or if the function was reinitialized,
                // insert the new value.
                if (!this.lastGrabObj || this.lastGrabObj[objProp] !== val || reinit[baseName]) {
                    inject += objProp + " = " + val + ";\n";
                }
            }).bind(this));

            // Deletion of old object properties
            for (var objProp in this.lastGrabObj) {
                if (!(objProp in this.grabObj)) {
                    inject += "delete " + objProp + ";\n";
                }
            }

            // Make sure that deleted variables are removed.
            // Go through all the previously-defined properties and check to see
            // if they've been removed.
            /* jshint forin:false */
            for (var oldProp in this.lastGrab) {
                // ignore KAInfiniteLoop functions
                if (/^KAInfiniteLoop/.test(oldProp)) {
                    continue;
                }
                // If the property doesn't exist in this grab extraction and
                // the property isn't a Processing.js-defined property
                // (e.g. don't delete 'background') but allow the 'draw'
                // function to be deleted (as it's user-defined)
                if (!(oldProp in grabAll) && (!(oldProp in this.props) || this.drawLoopMethods.includes(oldProp))) {
                    // Create the code to delete the variable
                    inject += "delete " + oldProp + ";\n";

                    // If the draw function was deleted we also
                    // need to clear the display
                    if (oldProp === "draw") {
                        this.clear();
                        this.processing.draw = this.DUMMY;
                    }
                }
            }
        }

        // Make sure the matrix is always reset
        this.processing.resetMatrix();

        // Seed the random number generator with the same seed
        this.restoreRandomSeed();

        // Make sure the various draw styles are also reset
        // if they were just removed
        if (this.lastGrab) {
            Object.keys(this.liveReset).forEach(function (prop) {
                if (!_this5.globals[prop] && _this5.lastGrab[prop]) {
                    _this5.processing[prop].apply(_this5.processing, _this5.liveReset[prop]);
                }
            });
        }

        // Re-run the entire program if we don't need to inject the changes
        // (Injection only needs to occur if a draw loop exists and if a prior
        // run took place)
        if (!hasOrHadDrawLoop || !this.drawLoopMethodDefined() || !this.lastGrab || rerun) {
            // Clear the output if no injection is occurring
            this.clear();

            // Clear Processing logs
            this.processing._clearLogs();

            // Force a call to the draw function to force checks for instances
            // and to make sure that errors in the draw loop are caught.
            if (this.globals.draw) {
                userCode += "\ndraw();";
            }

            // Run the code as normal
            var error = this.exec(userCode, this.processing);
            if (error) { throw error; }

            // Attach names to all functions
            _each(this.globals, function (val, prop) {
                if (typeof val === "function") {
                    val.__name = prop;
                }
            });

            // Otherwise if there is code to inject
        } else if (inject || mutatingCalls.length > 0) {
            // Force a call to the draw function to force checks for instances
            // and to make sure that errors in the draw loop are caught.
            if (this.globals.draw) {
                inject += "\ndraw();";
            }

            // Execute the injected code
            var error = this.exec(inject, this.processing, mutatingCalls);
            if (error) { throw error; }
        }

        // Need to make sure that the draw function is never deleted
        // (Otherwise Processing.js starts to freak out)

        if (!this.processing.draw) {
            this.processing.draw = this.DUMMY;
        }

        // Save the extracted variables for later comparison
        if (hasOrHadDrawLoop) {
            this.lastGrab = grabAll;
            this.lastGrabObj = this.grabObj;
        }

    }

    /**
     * Transform processing-js code so that it can be run in a sandboxed
     * environment or exported so that it can run without live-editor (requires
     * processing.js)
     *
     * @param {String} code A string contain the code to transform.
     * @param {Object} context An object which contains methods which should
     * appear global to the code being run.  The code should be run using the
     * same context, see PJSCodeInjector::exec.
     * @param {String[]} [mutatingCalls] An array of strings containing calls
     * that change state and must be re-run in order to put a Processing
     * context back into a particular state.  This array is optional and is
     * only used when injecting code into a running Processing instance.
     * @param {Object} [options] Currently the only option supported is the
     * `rewriteNewExpression` property which controls whether or not to rewrite
     * `new` expressions as calls to PJSCodeInjector.applyInstance.
     * @returns {String} The transformed code.
    **/
    transformCode(code, context, mutatingCalls) {
        var options = arguments.length <= 3 || arguments[3] === undefined ? {} : arguments[3];
        var envName = this.envName;
        var enableLoopProtect = this.enableLoopProtect;
        var loopProtector = this.loopProtector;

        context.KAInfiniteLoopProtect = this.loopProtector.KAInfiniteLoopProtect;
        context.KAInfiniteLoopSetTimeout = this.loopProtector.KAInfiniteLoopSetTimeout;
        context.KAInfiniteLoopCount = 0;

        // Adding this to the context is required for any calls to applyInstance.
        // TODO(kevinb) We should change how we're rewriting constructor calls.
        // Currently we're doing a global replace which causes things that look
        // like 'new' calls in comments to be replaced as well.
        context.PJSCodeInjector = PJSCodeInjector;

        // This is necessary because sometimes 'code' is code that we want to
        // inject.  This injected code can contain code obtained from calling
        // .toString() on functions that were grabbed.  These may contain
        // references to KAInfiniteLoopCount that have already been prefixed
        // with a previous __env__ string.
        // TODO(kevinb) figure out how to use the AST so we're not calling .toString() on functions
        var envNameRegex = new RegExp(envName + "\\.", "g");
        var ast = esprima.parse(code.replace(envNameRegex, ""), { loc: true });

        var astTransformPasses = [];

        // 'mutatingCalls' is undefined only when we are injecting code.
        // This is not perfect protection from users typing one of these banned
        // properties, but it does guard against some cases.  The reason why
        // we're allowing these props in this case is that code that injected
        // is comes from calling .toString on functions which have already been
        // transformed from a previous call to exec().

        if (!mutatingCalls) {
            astTransformPasses.push(ASTTransforms.checkForBannedProps([
                "__env__",
                "KAInfiniteLoopCount",
                "KAInfiniteLoopProtect",
                "KAInfiniteLoopSetTimeout"
            ]));
        } else {
            astTransformPasses.push(ASTTransforms.checkForBannedProps([
                "__env__"
            ]));
        }
        // rewriteFunctionDeclarations turns function x() into var x = function
        astTransformPasses.push(ASTTransforms.rewriteFunctionDeclarations);

        // loopProtector adds LoopProtector code which checks how long it's
        // taking to run event loop and will throw if it's taking too long.
        if (enableLoopProtect && !mutatingCalls) {
            astTransformPasses.push(loopProtector);
        }

        try {
            walkAST(ast, null, astTransformPasses);
        } catch (e) {
            return e;
        }
        
        // rewriteContextVariables has to be done separately because loopProtector
        // adds variable references which need to be rewritten.
        // Profile first before trying to combine these two passes.  It may be
        // that parsing is dominating
        walkAST(ast, null, [ASTTransforms.rewriteContextVariables(envName, context)]);

        code = "";
        if (mutatingCalls) {
            // Prepend injected function calls with envName and any arguments
            // that are objects with envName as well.  This is a lot quicker
            // than parsing these and using rewriteContextVariables, especially
            // if there are a lot of inject function calls.
            code += mutatingCalls.map(function (call) {
                call = call.replace(/__obj__/g, envName + ".__obj__");
                return envName + "." + call;
            }).join("\n");
        }
        
        return code + escodegen.generate(ast);
    }

    /**
     * Exports code so that it can be run without live-editor (requires
     * processing.js)
     *
     * @param {string} code
     * @param {string} imageDir
     * @param {string} soundDir
     * @returns {string}
    **/
    exportCode(code, imageDir, soundDir) {
        var options = {
            rewriteNewExpression: false
        };
        var transformedCode = this.transformCode(code, this.processing, null, options);
        var helperCode = "";
        var resources = PJSResourceCache.findResources(transformedCode);

        // TODO(kevinb) generate this code once (once webpack is in place)
        helperCode += "var resources = " + JSON.stringify(resources) + ";\n";
        helperCode += PJSUtils.cleanupCode(PJSUtils.codeFromFunction(function () {
            var resourceCache = [];
            // __IMAGEDIR__
            // __SOUNDDIR__

            var imageHolder = document.createElement("div");

            imageHolder.style.height = 0;
            imageHolder.style.width = 0;
            imageHolder.style.overflow = "hidden";
            imageHolder.style.position = "absolute";

            document.body.appendChild(imageHolder);

            var loadImage = function loadImage(filename) {
                return new Promise(function (resolve) {
                    var img = document.createElement("img");
                    img.onload = function () {
                        resourceCache[filename] = img;
                        resolve();
                    };
                    img.onerror = function () {
                        resolve(); // always resolve
                    };

                    img.src = /^(http:|https:)\/\//.test(filename) ? filename : "https://www.kasandbox.org/programming-images/" + filename;
                    imageHolder.appendChild(img);
                    resourceCache[filename] = img;
                });
            };

            var loadSound = function loadSound(filename) {
                return new Promise(function (resolve) {
                    var audio = document.createElement("audio");
                    var parts = filename.split("/");

                    var group = _findWhere(OutputSounds[0].groups, { groupName: parts[0] });

                    if (!group || group.sounds.indexOf(parts[1].replace(".mp3", "")) === -1) {
                        resolve();
                        return;
                    }

                    audio.preload = "auto";
                    audio.oncanplaythrough = function () {
                        resourceCache[filename] = audio;
                        resolve();
                    };
                    audio.onerror = function () {
                        resolve();
                    };

                    audio.src = /^(http:|https:)\/\//.test(filename) ? filename : "https://cdn.kastatic.org/third_party/javascript-khansrc/live-editor/sounds/" + filename;
                });
            };

            var promises = Object.keys(resources).map(function (filename) {
                if (filename.indexOf(".png") !== -1) {
                    return loadImage(filename);
                } else if (filename.indexOf(".mp3") !== -1) {
                    return loadSound(filename);
                }
            });

            Promise.all(promises).then(function () {
                var canvas = document.createElement("canvas");
                canvas.width = 400;
                canvas.height = 400;

                var p = new Processing(canvas);

                p.width = 400;
                p.height = 400;

                p.getSound = function (sound) {
                    return resourceCache[sound + ".mp3"];
                };

                p.playSound = function (sound) {
                    if (sound && sound.play) {
                        sound.currentTime = 0;
                        sound.play();
                    } else {
                        throw new Error("No sound file provided.");
                    }
                };

                p.getImage = function (image) {
                    return new p.PImage(resourceCache[image + ".png"]);
                };

                // __USERCODE__

                if (p.draw) {
                    p.loop();
                }
            });
        })) + "\n";

        return helperCode.replace(/\/\/ __USERCODE__/g, transformedCode).replace(/\/\/ __IMAGEDIR__/g, "var imageDir = \"" + imageDir + "\"").replace(/\/\/ __SOUNDDIR__/g, "var soundDir = \"" + soundDir + "\"");
    }

    /**
     * Executes the user's code.
     *
     * @param {string} code The user code to execute.
     * @param {Object} context An object containing global object we'd like the
     * user to have access to.  It's also used to capture objects that the user
     * defines so that we can re-inject them into the execution context as
     * users modify their programs.
     * @param {Array} [mutatingCalls] An array of strings containing all of the
     * function calls to be injected.
     * @returns {Error}
    **/
    exec(code, context, mutatingCalls) {
        if (!code) {
            return;
        }

        // the top-level 'this' is empty except for this.externals, which
        // throws this message this is how users were getting at everything
        // from playing sounds to displaying pop-ups
        var badProgram = "This program uses capabilities we've turned off for security reasons. Khan Academy prohibits showing external images, playing external sounds, or displaying pop-ups.";
        var topLevelThis = "{ get externals() { throw { message: " + JSON.stringify(badProgram) + " } } }";

        try {
            var transformedCode = this.transformCode(code, context, mutatingCalls);
            var funcBody = "var " + this.envName + " = context;\n" + ("(function(){\n" + transformedCode + "\n}).apply(" + topLevelThis + ");");
            var func = new Function("context", funcBody);
            func(context);

        } catch (e) {
            return e;
        }
    }

    /**
     * Turn a JavaScript object into a form that can be executed
     * (Note: The form will not necessarily be able to pass a JSON linter)
     * (Note: JSON.stringify might throw an exception. We don't capture it
     *        here as we'll want to deal with it later.)
    **/
    static stringify(obj) {
        // Use toString on functions
        if (typeof obj === "function") {
            return obj.toString();

            // If we're dealing with an instantiated object just
            // use its generated ID
        } else if (obj && obj.__id) {
            return obj.__id();

            // Check if we're dealing with an array
        } else if (obj && Object.prototype.toString.call(obj) === "[object Array]") {
            return this.stringifyArray(obj);

            // JSON.stringify returns undefined, not as a string, so we specially
            // handle that
        } else if (typeof obj === "undefined") {
            return "undefined";
        }

        // If all else fails, attempt to JSON-ify the string
        // TODO(jeresig): We should probably do recursion to better handle
        // complex objects that might hold instances.
        return JSON.stringify(obj, function (k, v) {
            // Don't jsonify the canvas or its context because it can lead
            // to circular jsonification errors on chrome.
            if (v && (v.id !== undefined && v.id === "output-canvas" || typeof CanvasRenderingContext2D !== "undefined" && v instanceof CanvasRenderingContext2D)) {
                return undefined;
            }
            return v;
        });
    }

    /**
     * Turn an array into a string list
     * (Especially useful for serializing a list of arguments)
    **/
    static stringifyArray(array) {
        var results = [];

        for (var i = 0, l = array.length; i < l; i++) {
            results.push(this.stringify(array[i]));
        }

        return results.join(", ");
    }

    /**
     * Turn an array into a string list
     * (Especially useful for serializing a list of arguments)
    **/
    static stringifyArray(array) {
        var results = [];

        for (var i = 0, l = array.length; i < l; i++) {
            results.push(this.stringify(array[i]));
        }

        return results.join(", ");
    }

    static applyInstance(classFn) { }

    static newCallback() { }

    static instances = [];
}

window.PJSCodeInjector = PJSCodeInjector;
window.LoopProtector = LoopProtector;
window.PJSUtils = PJSUtils;


export { PJSCodeInjector };
