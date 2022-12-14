# KhanPJS.js
KhanPJS is just Khanacademy's PJS enviroment but optimized and without the need of their live editor.

Almost every PJS program can run in it. The only limitations being things i intentionally removed.

## CDN
    https://cdn.jsdelivr.net/gh/L1quidH2O/KhanPJS/build/KhanPJS.min.js
-------------------------------
## HOW TO USE
```js
var pjs = new KhanPJS({ // default values:
    canvas: document.querySelector("canvas"),
    enableLoopProtect: true,
    infiniteLoopCallback: function(error){},
    startupTimeout: 2000,
    programTimeout: 500,
    loopCheck: 1000,
});

pjs.runCode("background(255, 0, 0);", error=>console.log(error));
```

The first paramerer is an options object, all options are optional.

* canvas (HTMLCanvasElement), canvas to use for PJS. defaults to create its own. (OffscreenCanvas not supported)
    ```js
    var pjs = new KhanPJS();
    document.body.appendChild(pjs.canvas);
    ```
* enableLoopProtect, defaults to true
* infiniteLoopCallback, defaults to empty function
* startupTimeout, maximum time to wait for a program to load (some programs take a long time to load terrain/textures). defaults to 2000
* programTimeout, maximum time program is allowed to freeze. defaults to 500
* loopCheck, amount of iterations it takes before checking if theres an infinity loop. defaults to 1000. (hard to explain so see code)
    ```js
    for(var i = 0; i < 10000; i ++){
        //---placed by KhanPJS---
        KAInfiniteLoopCount++;
        if (KAInfiniteLoopCount > loopCheck) {
            //checks if program is frozen for too long
            KAInfiniteLoopProtect();
            KAInfiniteLoopCount = 0;
        }
        //-----------------------

        // do slow stuff
    }
    ```

### Methods:
```js
pjs.runCode("", error=>console.log(error));    //runs code
pjs.restart();      //restarts program
pjs.size(400, 400); //changes canvas size

//getters/setters:
pjs.enableLoopProtect = true;
pjs.startupTimeout = 2000;
pjs.programTimeout = 500;
pjs.loopCheck = 1000;

// other methods arent important
```

-------------------------------

## FEATURES
* Added ES6 `class` support
* Optimized some parts of Processing.js

-------------------------------

## LIMITATIONS
* Some "hacks" that are used by user programs but arent used by KhanPJS now have the same return type but no functionality (ex: `PJSCodeInjector.propListString` returns an empty string)

* Removed third party libraries that might be used by some user programs (ex: `i18n`)

* Only these classes are in the top scope
    - ASTTransforms
    - ASTTransforms
    - walkAST
    - AllImages
    - OutputImages
    - ExtendedOutputImages
    - OutputSounds
    - PJSCodeInjector
    - LoopProtector
    - PJSUtils
    - Processing

-------------------------------

## NOTES:
* Processing.js is huge and there are still some useless things in it.
