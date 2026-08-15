import js from "@eslint/js";
import globals from "globals";

export default [
	// third-party/vendored content: never lint or rewrite these
	{
		ignores: [
			"node_modules/**",
			"public/assets/games/**",
			"mynamescraxbackuphtmlfiles/**",
			"pnpm-lock.yaml",
		],
	},
	js.configs.recommended,
	{
		files: ["index.js", "monitor.js", "eslint.config.js"],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: {
				...globals.node,
			},
		},
	},
	{
		// browser scripts (classic scripts, no modules)
		files: ["public/js/**/*.js", "public/sw.js", "public/register-sw.js", "public/assets/data/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "script",
			globals: {
				...globals.browser,
				...globals.serviceworker,
				// cross-script globals: defined in one file, called/assigned
				// from another (or from inline HTML onclick= handlers)
				$scramjet: "readonly",
				$scramjetController: "readonly",
				registersw: "readonly",
				apps: "writable",
				autologin: "writable",
				authtoken: "writable",
				myusername: "writable",
				cleartoken: "readonly",
				getdeviceid: "readonly",
				ini: "readonly",
				esc: "readonly",
				timeago: "readonly",
				switchtab: "readonly",
				submitauth: "readonly",
				showapp: "writable",
				savetoken: "readonly",
			},
		},
		rules: {
			// these files intentionally use var/args-style idioms for
			// old-Safari compatibility and are driven by inline HTML handlers;
			// enforce correctness, not style
			"no-unused-vars": "off",
			// classic scripts define globals in one file and consume them from
			// another (dm-shared.js → chat.js) — that's the design, not a bug
			"no-redeclare": "off",
			"no-empty": ["error", { allowEmptyCatch: true }],
			// `<\/script>` inside string literals is deliberate: it keeps the
			// strings safe to inline into HTML <script> contexts
			"no-useless-escape": "off",
			// defensive `catch { x = false }` resets after an initial false
			"no-useless-assignment": "off",
		},
	},
	{
		// deliberately minified-style ad-spoof shim
		files: ["public/js/ad-spoof.js"],
		rules: {
			"no-setter-return": "off",
		},
	},
];
