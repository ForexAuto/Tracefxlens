/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/@serwist/next/dist/sw-entry-worker.mjs":
/*!*************************************************************!*\
  !*** ./node_modules/@serwist/next/dist/sw-entry-worker.mjs ***!
  \*************************************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval(__webpack_require__.ts("__webpack_require__.r(__webpack_exports__);\n//#region src/sw-entry-worker.ts\nself.onmessage = async (ev) => {\n\tswitch (ev.data.type) {\n\t\tcase \"__START_URL_CACHE__\": {\n\t\t\tconst url = ev.data.url;\n\t\t\tconst response = await fetch(url);\n\t\t\tif (!response.redirected) return (await caches.open(\"start-url\")).put(url, response);\n\t\t\treturn Promise.resolve();\n\t\t}\n\t\tcase \"__FRONTEND_NAV_CACHE__\": {\n\t\t\tconst url = ev.data.url;\n\t\t\tconst pagesCache = await caches.open(\"pages\");\n\t\t\tif (!!await pagesCache.match(url, { ignoreSearch: true })) return;\n\t\t\tconst page = await fetch(url);\n\t\t\tif (!page.ok) return;\n\t\t\tpagesCache.put(url, page.clone());\n\t\t\treturn Promise.resolve();\n\t\t}\n\t\tdefault: return Promise.resolve();\n\t}\n};\n//#endregion\n\n\n//# sourceMappingURL=sw-entry-worker.mjs.map//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiLi9ub2RlX21vZHVsZXMvQHNlcndpc3QvbmV4dC9kaXN0L3N3LWVudHJ5LXdvcmtlci5tanMiLCJtYXBwaW5ncyI6IjtBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHVDQUF1QyxvQkFBb0I7QUFDM0Q7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ1U7O0FBRVYiLCJzb3VyY2VzIjpbIi9hcHAvYXBwbGV0L25vZGVfbW9kdWxlcy9Ac2Vyd2lzdC9uZXh0L2Rpc3Qvc3ctZW50cnktd29ya2VyLm1qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyNyZWdpb24gc3JjL3N3LWVudHJ5LXdvcmtlci50c1xuc2VsZi5vbm1lc3NhZ2UgPSBhc3luYyAoZXYpID0+IHtcblx0c3dpdGNoIChldi5kYXRhLnR5cGUpIHtcblx0XHRjYXNlIFwiX19TVEFSVF9VUkxfQ0FDSEVfX1wiOiB7XG5cdFx0XHRjb25zdCB1cmwgPSBldi5kYXRhLnVybDtcblx0XHRcdGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsKTtcblx0XHRcdGlmICghcmVzcG9uc2UucmVkaXJlY3RlZCkgcmV0dXJuIChhd2FpdCBjYWNoZXMub3BlbihcInN0YXJ0LXVybFwiKSkucHV0KHVybCwgcmVzcG9uc2UpO1xuXHRcdFx0cmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuXHRcdH1cblx0XHRjYXNlIFwiX19GUk9OVEVORF9OQVZfQ0FDSEVfX1wiOiB7XG5cdFx0XHRjb25zdCB1cmwgPSBldi5kYXRhLnVybDtcblx0XHRcdGNvbnN0IHBhZ2VzQ2FjaGUgPSBhd2FpdCBjYWNoZXMub3BlbihcInBhZ2VzXCIpO1xuXHRcdFx0aWYgKCEhYXdhaXQgcGFnZXNDYWNoZS5tYXRjaCh1cmwsIHsgaWdub3JlU2VhcmNoOiB0cnVlIH0pKSByZXR1cm47XG5cdFx0XHRjb25zdCBwYWdlID0gYXdhaXQgZmV0Y2godXJsKTtcblx0XHRcdGlmICghcGFnZS5vaykgcmV0dXJuO1xuXHRcdFx0cGFnZXNDYWNoZS5wdXQodXJsLCBwYWdlLmNsb25lKCkpO1xuXHRcdFx0cmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuXHRcdH1cblx0XHRkZWZhdWx0OiByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG5cdH1cbn07XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7fTtcblxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9c3ctZW50cnktd29ya2VyLm1qcy5tYXAiXSwibmFtZXMiOltdLCJpZ25vcmVMaXN0IjpbMF0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///./node_modules/@serwist/next/dist/sw-entry-worker.mjs\n"));

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The require scope
/******/ 	var __webpack_require__ = {};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/trusted types policy */
/******/ 	(() => {
/******/ 		var policy;
/******/ 		__webpack_require__.tt = () => {
/******/ 			// Create Trusted Type policy if Trusted Types are available and the policy doesn't exist yet.
/******/ 			if (policy === undefined) {
/******/ 				policy = {
/******/ 					createScript: (script) => (script)
/******/ 				};
/******/ 				if (typeof trustedTypes !== "undefined" && trustedTypes.createPolicy) {
/******/ 					policy = trustedTypes.createPolicy("nextjs#bundler", policy);
/******/ 				}
/******/ 			}
/******/ 			return policy;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/trusted types script */
/******/ 	(() => {
/******/ 		__webpack_require__.ts = (script) => (__webpack_require__.tt().createScript(script));
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/react refresh */
/******/ 	(() => {
/******/ 		if (__webpack_require__.i) {
/******/ 		__webpack_require__.i.push((options) => {
/******/ 			const originalFactory = options.factory;
/******/ 			options.factory = (moduleObject, moduleExports, webpackRequire) => {
/******/ 				const hasRefresh = typeof self !== "undefined" && !!self.$RefreshInterceptModuleExecution$;
/******/ 				const cleanup = hasRefresh ? self.$RefreshInterceptModuleExecution$(moduleObject.id) : () => {};
/******/ 				try {
/******/ 					originalFactory.call(this, moduleObject, moduleExports, webpackRequire);
/******/ 				} finally {
/******/ 					cleanup();
/******/ 				}
/******/ 			}
/******/ 		})
/******/ 		}
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	
/******/ 	// noop fns to prevent runtime errors during initialization
/******/ 	if (typeof self !== "undefined") {
/******/ 		self.$RefreshReg$ = function () {};
/******/ 		self.$RefreshSig$ = function () {
/******/ 			return function (type) {
/******/ 				return type;
/******/ 			};
/******/ 		};
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval-source-map devtool is used.
/******/ 	var __webpack_exports__ = {};
/******/ 	__webpack_modules__["./node_modules/@serwist/next/dist/sw-entry-worker.mjs"](0, __webpack_exports__, __webpack_require__);
/******/ 	
/******/ })()
;