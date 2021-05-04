/*

kaboom.js
v0.4.1 "Multiboom"

a JavaScript game programming library

= Author
tga <tga@space55.xyz>

= License

Copyright (C) 2021 Replit

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

*/

type KaboomConf = {
	width?: number,
	height?: number,
	scale?: number,
	fullscreen?: boolean,
	debug?: boolean,
	crisp?: boolean,
	canvas?: HTMLCanvasElement,
	root?: HTMLElement,
	clearColor?: number[],
	global?: boolean,
	plugins?: Array<(KaboomCtx) => Record<string, any>>,
};

import {
	Vec2,
	Vec3,
	Quad,
	Color,
	Mat4,
	vec2,
	vec3,
	mat4,
	quad,
	rgba,
	rgb,
	makeRng,
	rand,
	randSeed,
	chance,
	choose,
	clamp,
	lerp,
	map,
	wave,
	deg2rad,
	rad2deg,
	colRectRect,
	overlapRectRect,
	colLineLine,
	colRectLine,
	colRectPt,
	vec2FromAngle,
	isVec2,
	isColor,
} from "./math";

import {
	GfxBatchedMesh,
	Vertex,
	GfxFont,
	GfxTexture,
	GfxTextureData,
	GfxProgram,
	GfxCtx,
} from "./gfx";

import unsciiSrc from "./unscii_8x8.png";
import defVertSrc from "./vert.glsl";
import defFragSrc from "./frag.glsl";

module.exports = (gconf: KaboomConf = {
	width: 640,
	height: 480,
	scale: 1,
	fullscreen: false,
	debug: false,
	crisp: false,
	canvas: null,
	root: document.body,
}) => {

/*

*11111111*

assets     *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

const ASCII_CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
const DEF_FONT = "unscii";

type SpriteAnim = {
	start: number,
	end: number,
};

type SpriteLoadConf = {
	sliceX?: number,
	sliceY?: number,
	anims?: Record<string, SpriteAnim>,
};

type SpriteLoadSrc = string | GfxTextureData;

type LoadTracker = {
	done: () => void,
};

type SpriteData = {
	tex: GfxTexture,
	frames: Quad[],
	anims: Record<string, SpriteAnim>,
};

type SoundData = AudioBuffer;
type FontData = GfxFont;

type AssetCtx = {
	lastLoaderID: number,
	loadRoot: string,
	loaders: Record<number, boolean>,
	sprites: Record<string, SpriteData>,
	sounds: Record<string, SoundData>,
	fonts: Record<string, FontData>,
}

const assets: AssetCtx = {
	lastLoaderID: 0,
	loadRoot: "",
	loaders: {},
	sprites: {},
	sounds: {},
	fonts: {},
};

function assetsInit() {
	// default font unscii http://pelulamu.net/unscii/
	loadFont(
		DEF_FONT,
		unsciiSrc,
		8,
		8
	);
}

function loadImg(src): Promise<HTMLImageElement> {

	const img = new Image();

	img.crossOrigin = "";
	img.src = src;

	return new Promise((resolve, reject) => {
		img.onload = () => {
			resolve(img);
		};
		img.onerror = () => {
			reject();
		};
	});

}

// make a new load tracker
// the game starts after all trackers are done()
function newLoader(): LoadTracker {
	const id = assets.lastLoaderID;
	assets.loaders[id] = false;
	assets.lastLoaderID++;
	return {
		done() {
			assets.loaders[id] = true;
		},
	};
}

// get current load progress
function loadProgress(): number {

	let total = 0;
	let loaded = 0;

	for (const id in assets.loaders) {
		total += 1;
		if (assets.loaders[id]) {
			loaded += 1;
		}
	}

	return loaded / total;

}

// global load path prefix
function loadRoot(path: string): string {
	if (path) {
		assets.loadRoot = path;
	}
	return assets.loadRoot;
}

function isDataUrl(src: string) {
	return src.startsWith("data:");
}

// load a bitmap font to asset manager
function loadFont(
	name: string,
	src: string,
	gw: number,
	gh: number,
	chars: string = ASCII_CHARS
): Promise<FontData> {

	return new Promise((resolve, reject) => {

		const loader = newLoader();
		const path = isDataUrl(src) ? src : assets.loadRoot + src;

		loadImg(path)
			.then((img) => {
				assets.fonts[name] = makeFont(makeTex(img), gw, gh, chars);
				resolve(assets.fonts[name]);
			})
			.catch(() => {
				error(`failed to load font '${name}' from '${src}'`);
				reject();
			})
			.finally(() => {
				loader.done();
			});

	});

}

// TODO: use getSprite() functions for async settings
// load a sprite to asset manager
function loadSprite(
	name: string,
	src: SpriteLoadSrc,
	conf: SpriteLoadConf = {
		sliceX: 1,
		sliceY: 1,
		anims: {},
	},
): Promise<SpriteData> {

	// synchronously load sprite from local pixel data
	function loadRawSprite(
		name: string,
		src: GfxTextureData,
		conf: SpriteLoadConf = {
			sliceX: 1,
			sliceY: 1,
			anims: {},
		},
	) {

		const frames = [];
		const tex = makeTex(src);
		const sliceX = conf.sliceX || 1;
		const sliceY = conf.sliceY || 1;
		const qw = 1 / sliceX;
		const qh = 1 / sliceY;

		for (let j = 0; j < sliceY; j++) {
			for (let i = 0; i < sliceX; i++) {
				frames.push(quad(
					i * qw,
					j * qh,
					qw,
					qh,
				));
			}
		}

		const sprite = {
			tex: tex,
			frames: frames,
			anims: conf.anims || {},
		};

		assets.sprites[name] = sprite;

		return sprite;

	}

	return new Promise((resolve, reject) => {

		// from url
		if (typeof(src) === "string") {

			const loader = newLoader();
			const path = isDataUrl(src) ? src : assets.loadRoot + src;

			loadImg(path)
				.then((img) => {
					resolve(loadRawSprite(name, img, conf));
				})
				.catch(() => {
					error(`failed to load sprite '${name}' from '${src}'`);
					reject();
				})
				.finally(() => {
					loader.done();
				});

			return;

		} else {

			resolve(loadRawSprite(name, src, conf));

		}

	});

}

// load a sound to asset manager
function loadSound(
	name: string,
	src: string,
): Promise<SoundData> {

	return new Promise((resolve, reject) => {

		// from url
		if (typeof(src) === "string") {

			const loader = newLoader();

			fetch(assets.loadRoot + src)
				.then((res) => {
					return res.arrayBuffer();
				})
				.then((data) => {
					return new Promise((resolve2, reject2) => {
						audio.ctx.decodeAudioData(data, (buf) => {
							resolve2(buf);
						}, (err) => {
							reject2();
						});
					});
				})
				.then((buf: AudioBuffer) => {
					assets.sounds[name] = buf;
				})
				.catch(() => {
					error(`failed to load sound '${name}' from '${src}'`);
					reject();
				})
				.finally(() => {
					loader.done();
				});

		}

	});

}

/*

*22222*

app        *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

type ButtonState =
	"up"
	| "pressed"
	| "rpressed"
	| "down"
	| "released"
	;

type AppCtx = {
	canvas: HTMLCanvasElement,
	mousePos: Vec2,
	mouseState: ButtonState,
	keyStates: Record<string, ButtonState>,
	charInputted: string[],
	time: number,
	dt: number,
	realTime: number,
	skipTime: boolean,
	scale: number,
	isTouch: boolean,
};

// app system init
const app: AppCtx = {
	keyStates: {},
	charInputted: [],
	mouseState: "up",
	mousePos: vec2(0, 0),
	time: 0,
	realTime: 0,
	skipTime: false,
	dt: 0.0,
	scale: 1,
	isTouch: false,
};

const keyMap = {
	"ArrowLeft": "left",
	"ArrowRight": "right",
	"ArrowUp": "up",
	"ArrowDown": "down",
	" ": "space",
};

const preventDefaultKeys = [
	"space",
	"left",
	"right",
	"up",
	"down",
	"tab",
	"f1",
	"f2",
	"f3",
	"f4",
	"f5",
	"f6",
	"f7",
	"f8",
	"f9",
	"f10",
	"f11",
];

let gl;

function appInit() {

	app.canvas = gconf.canvas;

	if (!app.canvas) {
		app.canvas = document.createElement("canvas");
		const root = gconf.root || document.body;
		root.appendChild(app.canvas);
	}

	app.scale = gconf.scale || 1;

	if (gconf.fullscreen) {
		app.canvas.width = window.innerWidth;
		app.canvas.height = window.innerHeight;
	} else {
		app.canvas.width = (gconf.width || 640) * app.scale;
		app.canvas.height = (gconf.height || 480) * app.scale;
	}

	const styles = [
		"outline: none",
	];

	if (gconf.crisp) {
		styles.push("image-rendering: pixelated");
		styles.push("image-rendering: crisp-edges");
	}

	app.canvas.style = styles.join(";");
	app.canvas.setAttribute("tabindex", "0");

	gl = app.canvas
		.getContext("webgl", {
			antialias: true,
			depth: true,
			stencil: true,
			alpha: true,
			preserveDrawingBuffer: true,
		});

	gfxInit();
	audioInit();
	assetsInit();

	app.isTouch = ("ontouchstart" in window) ||
		(navigator.maxTouchPoints > 0) ||
		(navigator.msMaxTouchPoints > 0);

	app.canvas.addEventListener("contextmenu", (e) => {
		e.preventDefault();
	});

	app.canvas.addEventListener("mousemove", (e) => {
		app.mousePos = vec2(e.offsetX, e.offsetY).scale(1 / app.scale);
	});

	app.canvas.addEventListener("mousedown", (e) => {
		app.mouseState = "pressed";
	});

	app.canvas.addEventListener("mouseup", (e) => {
		app.mouseState = "released";
	});

	app.canvas.addEventListener("touchstart", (e) => {
		const t = e.touches[0];
		app.mousePos = vec2(t.clientX, t.clientY).scale(1 / app.scale);
		app.mouseState = "pressed";
	});

	app.canvas.addEventListener("touchmove", (e) => {
		const t = e.touches[0];
		app.mousePos = vec2(t.clientX, t.clientY).scale(1 / app.scale);
	});

	app.canvas.addEventListener("keydown", (e) => {

		const k = keyMap[e.key] || e.key.toLowerCase();

		if (preventDefaultKeys.includes(k)) {
			e.preventDefault();
		}

		if (k.length === 1) {
			app.charInputted.push(k);
		}

		if (k === "space") {
			app.charInputted.push(" ");
		}

		if (e.repeat) {
			app.keyStates[k] = "rpressed";
		} else {
			app.keyStates[k] = "pressed";
		}

	});

	app.canvas.addEventListener("keyup", (e) => {
		const k = keyMap[e.key] || e.key.toLowerCase();
		app.keyStates[k] = "released";
	});

	app.canvas.focus();

	document.addEventListener("visibilitychange", (e) => {
		switch (document.visibilityState) {
			case "visible":
				// prevent a surge of dt() when switch back after the tab being hidden for a while
				app.skipTime = true;
				audio.ctx.resume();
				break;
			case "hidden":
				audio.ctx.suspend();
				break;
		}
	});

	if (gconf.debug) {
		debug.showLog = true;
	}

}

function processBtnState(s) {
	if (s === "pressed" || s === "rpressed") {
		return "down";
	}
	if (s === "released") {
		return "up";
	}
	return s;
}

// check input state last frame
function mousePos(layer?: string) {

	const scene = curScene();

	if (!layer) {
		return app.mousePos.clone();
	} else {
		return scene.cam.ignore.includes(layer) ? mousePos() : scene.cam.mpos;
	}

}

function mouseIsClicked() {
	return app.mouseState === "pressed";
}

function mouseIsDown() {
	return app.mouseState === "pressed" || app.mouseState === "down";
}

function mouseIsReleased() {
	return app.mouseState === "released";
}

function keyIsPressed(k) {
	return app.keyStates[k] === "pressed";
}

function keyIsPressedRep(k) {
	return app.keyStates[k] === "pressed" || app.keyStates[k] === "rpressed";
}

function keyIsDown(k) {
	return app.keyStates[k] === "pressed"
		|| app.keyStates[k] === "rpressed"
		|| app.keyStates[k] === "down";
}

function keyIsReleased(k) {
	return app.keyStates[k] === "released";
}

function charInputted() {
	return app.charInputted;
}

// get delta time between last frame
function dt() {
	return app.dt;
}

// get current running time
function time() {
	return app.time;
}

// get a base64 png image of canvas
function screenshot() {
	return app.canvas.toDataURL();
}

/*

*33333*

gfx        *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

const STRIDE = 9;

const gfx: GfxCtx = {
	drawCalls: 0,
	curTex: null,
	transform: mat4(),
	transformStack: [],
};

function gfxInit() {

	gfx.mesh = makeBatchedMesh(65536, 65536);
	gfx.defProg = makeProgram(defVertSrc, defFragSrc);
	gfx.defTex = makeTex(
		new ImageData(new Uint8ClampedArray([ 255, 255, 255, 255, ]), 1, 1)
	);
	const c = gconf.clearColor ?? [0, 0, 0, 1];
	gl.clearColor(c[0], c[1], c[2], c[3]);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	gl.depthFunc(gl.LEQUAL);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

}

// draw all cached vertices in the batched renderer
function flush() {

	gfx.mesh.flush();

	if (!gfx.curTex) {
		return;
	}

	gfx.mesh.bind();
	gfx.defProg.bind();
	gfx.curTex.bind();

	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * 4, 12);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE * 4, 20);
	gl.enableVertexAttribArray(2);

	gl.drawElements(gl.TRIANGLES, gfx.mesh.count(), gl.UNSIGNED_SHORT, 0);
	gfx.drawCalls++;

	gfx.defProg.unbind();
	gfx.mesh.unbind();
	gfx.curTex = null;

}

function gfxFrameStart() {
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gfx.drawCalls = 0;
	gfx.transformStack = [];
	gfx.transform = mat4();
}

function toNDC(pt: Vec2): Vec2 {
	return vec2(
		pt.x / width() * 2 - 1,
		-pt.y / height() * 2 + 1,
	);
}

function gfxFrameEnd() {
	flush();
}

// TODO: don't use push as prefix for these
function pushMatrix(m: Mat4) {
	gfx.transform = m.clone();
}

function pushTranslate(p: Vec2) {
	if (!p || (p.x === 0 && p.y === 0)) {
		return;
	}
	gfx.transform = gfx.transform.translate(p);
}

function pushScale(p: Vec2) {
	if (!p || (p.x === 0 && p.y === 0)) {
		return;
	}
	gfx.transform = gfx.transform.scale(p);
}

function pushRotateX(a: number) {
	if (!a) {
		return;
	}
	gfx.transform = gfx.transform.rotateX(a);
}

function pushRotateY(a: number) {
	if (!a) {
		return;
	}
	gfx.transform = gfx.transform.rotateY(a);
}

function pushRotateZ(a: number) {
	if (!a) {
		return;
	}
	gfx.transform = gfx.transform.rotateZ(a);
}

function pushTransform() {
	gfx.transformStack.push(gfx.transform.clone());
}

function popTransform() {
	if (gfx.transformStack.length > 0) {
		gfx.transform = gfx.transformStack.pop();
	}
}

// the batch renderer
function makeBatchedMesh(vcount: number, icount: number): GfxBatchedMesh {

	const vbuf = gl.createBuffer();

	gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
	gl.bufferData(gl.ARRAY_BUFFER, vcount * 32, gl.DYNAMIC_DRAW);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);

	const ibuf = gl.createBuffer();

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, icount * 2, gl.DYNAMIC_DRAW);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	let numIndices = 0;

	return {

		vbuf: vbuf,
		ibuf: ibuf,
		vqueue: [],
		iqueue: [],

		push(verts, indices) {
			// TODO: deal with overflow
			indices = indices.map((i) => {
				return i + this.vqueue.length / STRIDE;
			});
			this.vqueue = this.vqueue.concat(verts);
			this.iqueue = this.iqueue.concat(indices);
		},

		flush() {

			gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf);
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(this.vqueue));
			gl.bindBuffer(gl.ARRAY_BUFFER, null);

			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibuf);
			gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, new Uint16Array(this.iqueue));
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

			numIndices = this.iqueue.length;

			this.iqueue = [];
			this.vqueue = [];

		},

		bind() {
			gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibuf);
		},

		unbind() {
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
		},

		count() {
			return numIndices;
		},

	};

}

function makeTex(data: GfxTextureData): GfxTexture {

	const id = gl.createTexture();

	gl.bindTexture(gl.TEXTURE_2D, id);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindTexture(gl.TEXTURE_2D, null);

	return {
		id: id,
		width: data.width,
		height: data.height,
		bind() {
			gl.bindTexture(gl.TEXTURE_2D, this.id);
		},
		unbind() {
			gl.bindTexture(gl.TEXTURE_2D, null);
		},
	};

}

function makeProgram(
	vertSrc: string,
	fragSrc: string
): GfxProgram {

	const vertShader = gl.createShader(gl.VERTEX_SHADER);

	gl.shaderSource(vertShader, vertSrc);
	gl.compileShader(vertShader);

	var msg = gl.getShaderInfoLog(vertShader);

	if (msg) {
		error(msg);
	}

	const fragShader = gl.createShader(gl.FRAGMENT_SHADER);

	gl.shaderSource(fragShader, fragSrc);
	gl.compileShader(fragShader);

	var msg = gl.getShaderInfoLog(fragShader);

	if (msg) {
		error(msg);
	}

	const id = gl.createProgram();

	gl.attachShader(id, vertShader);
	gl.attachShader(id, fragShader);

	gl.bindAttribLocation(id, 0, "a_pos");
	gl.bindAttribLocation(id, 1, "a_uv");
	gl.bindAttribLocation(id, 2, "a_color");

	gl.linkProgram(id);

	var msg = gl.getProgramInfoLog(id);

	if (msg) {
		error(msg);
	}

	return {

		id: id,

		bind() {
			gl.useProgram(this.id);
		},

		unbind() {
			gl.useProgram(null);
		},

		sendFloat(name, val) {
			const loc = gl.getUniformLocation(this.id, name);
			gl.uniform1f(loc, val);
		},

		sendVec2(name, x, y) {
			const loc = gl.getUniformLocation(this.id, name);
			gl.uniform2f(loc, x, y);
		},

		sendVec3(name, x, y, z) {
			const loc = gl.getUniformLocation(this.id, name);
			gl.uniform3f(loc, x, y, z);
		},

		sendVec4(name, x, y, z, w) {
			const loc = gl.getUniformLocation(this.id, name);
			gl.uniform4f(loc, x, y, z, w);
		},

		sendMat4(name, m) {
			const loc = gl.getUniformLocation(this.id, name);
			gl.uniformMatrix4fv(loc, false, new Float32Array(m));
		},

	};

}

function makeFont(
	tex: GfxTexture,
	gw: number,
	gh: number,
	chars: string,
): GfxFont {

	const cols = tex.width / gw;
	const rows = tex.height / gh;
	const count = cols * rows;
	const qw = 1.0 / cols;
	const qh = 1.0 / rows;
	const map = {};
	const charMap = chars.split("").entries();

	for (const [i, ch] of charMap) {
		map[ch] = vec2(
			(i % cols) * qw,
			Math.floor(i / cols) * qh,
		);
	}

	return {
		tex: tex,
		map: map,
		qw: qw,
		qh: qh,
	};

}

function drawRaw(
	verts: Vertex[],
	indices: number[],
	tex: GfxTexture = gfx.defTex
) {

	// flush on texture change
	if (gfx.curTex !== tex) {
		flush();
		gfx.curTex = tex;
	}

	// update vertices to current transform matrix
	const nVerts = verts.map((v) => {
		const pt = toNDC(gfx.transform.multVec2(v.pos.xy()));
		return [
			pt.x, pt.y, v.pos.z,
			v.uv.x, v.uv.y,
			v.color.r, v.color.g, v.color.b, v.color.a
		];
	}).flat();

	gfx.mesh.push(nVerts, indices);

}

type DrawQuadConf = {
	pos?: Vec2,
	width?: number,
	height?: number,
	scale?: Vec2 | number,
	rot?: number,
	color?: Color,
	origin?: string,
	tex?: GfxTexture,
	quad?: Quad,
	z?: number,
};

// draw a textured quad
function drawQuad(conf: DrawQuadConf = {}) {

	const w = conf.width || 0;
	const h = conf.height || 0;
	const pos = conf.pos || vec2(0, 0);
	const origin = originPt(conf.origin || DEF_ORIGIN);
	const offset = origin.dot(vec2(w, h).scale(-0.5));
	const scale = vec2(conf.scale ?? 1);
	const rot = conf.rot || 0;
	const q = conf.quad || quad(0, 0, 1, 1);
	const z = 1 - (conf.z ?? 0);
	const color = conf.color || rgba(1, 1, 1, 1);

	// TODO: (maybe) not use matrix transform here?
	pushTransform();
	pushTranslate(pos);
	pushScale(scale);
	pushRotateZ(rot);
	pushTranslate(offset);

	drawRaw([
		{
			pos: vec3(-w / 2, h / 2, z),
			uv: vec2(q.x, q.y + q.h),
			color: color,
		},
		{
			pos: vec3(-w / 2, -h / 2, z),
			uv: vec2(q.x, q.y),
			color: color,
		},
		{
			pos: vec3(w / 2, -h / 2, z),
			uv: vec2(q.x + q.w, q.y),
			color: color,
		},
		{
			pos: vec3(w / 2, h / 2, z),
			uv: vec2(q.x + q.w, q.y + q.h),
			color: color,
		},
	], [0, 1, 3, 1, 2, 3], conf.tex);

	popTransform();

}

type DrawSpriteConf = {
	frame?: number,
	pos?: Vec2,
	scale?: Vec2 | number,
	rot?: number,
	color?: Color,
	origin?: string,
	quad?: Quad,
	z?: number,
};

function drawSprite(
	name: string | SpriteData,
	conf: DrawSpriteConf = {}
) {

	const spr = typeof name === "string" ? assets.sprites[name] : name;

	if (!spr) {
		console.warn(`sprite not found: ${name}`);
		return;
	}

	const q = { ...spr.frames[conf.frame || 0] };

	if (conf.quad) {
		q.x += conf.quad.x * q.w;
		q.y += conf.quad.y * q.h;
		q.w *= conf.quad.w;
		q.h *= conf.quad.h;
	}

	const w = spr.tex.width * q.w;
	const h = spr.tex.height * q.h;

	drawQuad({
		tex: spr.tex,
		quad: q,
		width: w,
		height: h,
		pos: conf.pos,
		scale: conf.scale,
		rot: conf.rot,
		color: conf.color,
		origin: conf.origin,
		z: conf.z,
	});

}

type DrawRectStrokeConf = {
	width?: number,
	scale?: Vec2 | number,
	rot?: number,
	color?: Color,
	origin?: string,
	z?: number,
};

function drawRectStroke(
	pos: Vec2,
	w: number,
	h: number,
	conf: DrawRectStrokeConf = {}
) {

	const offset = originPt(conf.origin || DEF_ORIGIN).dot(w, h).scale(0.5);
	const p1 = pos.add(vec2(-w / 2, -h / 2)).sub(offset);
	const p2 = pos.add(vec2(-w / 2,  h / 2)).sub(offset);
	const p3 = pos.add(vec2( w / 2,  h / 2)).sub(offset);
	const p4 = pos.add(vec2( w / 2, -h / 2)).sub(offset);

	drawLine(p1, p2, conf);
	drawLine(p2, p3, conf);
	drawLine(p3, p4, conf);
	drawLine(p4, p1, conf);

}

type DrawRectConf = {
	scale?: Vec2 | number,
	rot?: number,
	color?: Color,
	origin?: string,
	z?: number,
};

function drawRect(
	pos: Vec2,
	w: number,
	h: number,
	conf: DrawRectConf = {}
) {
	drawQuad({
		...conf,
		pos: pos,
		width: w,
		height: h,
	});
}

type DrawLineConf = {
	width?: number,
	color?: Color,
	z?: number,
};

// TODO: slow, use drawRaw() calc coords
function drawLine(
	p1: Vec2,
	p2: Vec2,
	conf: DrawLineConf = {},
) {

	const w = conf.width || 1;
	const h = p1.dist(p2);
	const rot = Math.PI / 2 - p1.angle(p2);

	drawQuad({
		...conf,
		pos: p1.add(p2).scale(0.5),
		width: w,
		height: h,
		rot: rot,
		origin: "center",
	});

}

function drawText(txt, conf = {}) {
	drawFmtText(fmtText(txt, conf));
}

// TODO: rotation
function drawFmtText(ftext) {
	for (const ch of ftext.chars) {
		drawQuad({
			tex: ch.tex,
			width: ch.tex.width * ch.quad.w,
			height: ch.tex.height * ch.quad.h,
			pos: ch.pos,
			scale: ch.scale,
			color: ch.color,
			quad: ch.quad,
			// TODO: topleft
			origin: "center",
			z: ch.z,
		});
	}
}

function drawPoly(conf = {}) {
	// TODO
}

function drawCircle(conf = {}) {
	// TODO
}

// get current canvas width
function width() {
	return gl.drawingBufferWidth / app.scale;
}

// get current canvas height
function height() {
	return gl.drawingBufferHeight / app.scale;
}

function originPt(orig) {
	if (isVec2(orig)) {
		return orig;
	}
	switch (orig) {
		case "topleft": return vec2(-1, -1);
		case "top": return vec2(0, -1);
		case "topright": return vec2(1, -1);
		case "left": return vec2(-1, 0);
		case "center": return vec2(0, 0);
		case "right": return vec2(1, 0);
		case "botleft": return vec2(-1, 1);
		case "bot": return vec2(0, 1);
		case "botright": return vec2(1, 1);
	}
}

type TextFmtConf = {
	font?: string,
	size?: number,
	pos?: Vec2,
	scale?: Vec2 | number,
	rot?: number,
	color?: Color,
	origin?: string,
	width?: number,
	z?: number,
};

type FormattedChar = {
	tex: GfxTexture,
	quad: Quad,
	ch: string,
	pos: Vec2,
	scale: Vec2,
	color: Color,
	origin: string,
	z: number,
};

type FormattedText = {
	width: number,
	height: number,
	chars: FormattedChar[],
};

// format text and return a list of chars with their calculated position
function fmtText(
	text: string,
	conf: TextFmtConf = {}
): FormattedText {

	const fontName = conf.font || DEF_FONT;
	const font = assets.fonts[fontName];

	if (!font) {
		error(`font not found: '${fontName}'`);
		return {
			width: 0,
			height: 0,
			chars: [],
		};
	}

	const chars = (text + "").split("");
	const gw = font.qw * font.tex.width;
	const gh = font.qh * font.tex.height;
	const size = conf.size || gh;
	const scale = vec2(size / gh).dot(vec2(conf.scale || 1));
	const cw = scale.x * gw;
	const ch = scale.y * gh;
	let curX = 0;
	let th = ch;
	let tw = 0;
	const flines = [[]];

	// check new lines and calc area size
	for (const char of chars) {
		// go new line if \n or exceeds wrap value
		if (char === "\n" || (conf.width ? (curX + cw > conf.width) : false)) {
			th += ch;
			curX = 0;
			flines.push([]);
		}
		if (char !== "\n") {
			flines[flines.length - 1].push(char);
			curX += cw;
		}
		tw = Math.max(tw, curX);
	}

	if (conf.width) {
		tw = conf.width;
	}

	// whole text offset
	const fchars = [];
	const pos = vec2(conf.pos);
	const offset = originPt(conf.origin || DEF_ORIGIN).scale(0.5);
	// this math is complicated i forgot how it works instantly
	const ox = -offset.x * cw - (offset.x + 0.5) * (tw - cw);
	const oy = -offset.y * ch - (offset.y + 0.5) * (th - ch);

	flines.forEach((line, ln) => {

		// line offset
		const oxl = (tw - line.length * cw) * (offset.x + 0.5);

		line.forEach((char, cn) => {
			const qpos = font.map[char];
			const x = cn * cw;
			const y = ln * ch;
			if (qpos) {
				fchars.push({
					tex: font.tex,
					quad: quad(qpos.x, qpos.y, font.qw, font.qh),
					ch: char,
					pos: vec2(pos.x + x + ox + oxl, pos.y + y + oy),
					color: conf.color,
					origin: conf.origin,
					scale: scale,
					z: conf.z,
				});
			}
		});
	});

	return {
		width: tw,
		height: th,
		chars: fchars,
	};

}

/*

*4444444*

audio      *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

type AudioCtx = {
	ctx: AudioContext,
	masterGain: GainNode,
};

// audio system init
const audio: AudioCtx = (() => {
	const ctx = new (window.AudioContext || window.webkitAudioContext)();
	const masterGain = ctx.createGain();
	return {
		ctx,
		masterGain,
	};
})();

function audioInit() {
	audio.masterGain = audio.ctx.createGain();
	audio.masterGain.gain.value = 1;
	audio.masterGain.connect(audio.ctx.destination);
}

// get / set master volume
function volume(v?: number): number {
	if (v !== undefined) {
		audio.masterGain.gain.value = v;
	}
	return audio.masterGain.gain.value;
}

type AudioPlayConf = {
	loop?: boolean,
	volume?: number,
	speed?: number,
	detune?: number,
	seek?: number,
};

type AudioPlay = {
	stop: () => void,
	resume: () => void,
	pause: () => void,
	paused: () => boolean,
	stopped: () => boolean,
	speed: (s: number) => number,
	detune: (d: number) => number,
	volume: (v: number) => number,
	time: () => number,
	duration: () => number,
	loop: () => void,
	unloop: () => void,
};

// plays a sound, returns a control handle
function play(
	id,
	conf: AudioPlayConf = {
		loop: false,
		volume: 1,
		speed: 1,
		detune: 0,
		seek: 0,
	},
): AudioPlay {

	const sound = assets.sounds[id];

	if (!sound) {
		error(`sound not found: "${id}"`);
		return;
	}

	const srcNode = audio.ctx.createBufferSource();

	srcNode.buffer = sound;
	srcNode.loop = conf.loop ? true : false;

	const gainNode = audio.ctx.createGain();

	srcNode.connect(gainNode);
	gainNode.connect(audio.masterGain);

	let seek = conf.seek ?? 0;
	let paused = false;
	let stopped = false;
	let speed = 1;
	let startTime = audio.ctx.currentTime;
	let stoppedTime = null;
	let emptyTime = 0;

	srcNode.start(0, seek);

	const handle = {

		stop() {
			srcNode.stop();
			stopped = true;
			stoppedTime = audio.ctx.currentTime;
		},

		resume() {
			if (paused) {
				srcNode.playbackRate.value = speed;
				paused = false;
				if (stoppedTime) {
					emptyTime += audio.ctx.currentTime - stoppedTime;
					stoppedTime = null;
				}
			}
		},

		pause() {
			// TODO: doesn't work on FireFox
			srcNode.playbackRate.value = 0;
			paused = true;
			stoppedTime = audio.ctx.currentTime;
		},

		paused(): boolean {
			return paused;
		},

		stopped(): boolean {
			return stopped;
		},

		speed(val: number): number {
			if (val !== undefined) {
				speed = clamp(val, 0, 2);
				if (!paused) {
					srcNode.playbackRate.value = speed;
				}
			}
			return speed;
		},

		detune(val: number): number {
			if (!srcNode.detune) {
				return 0;
			}
			if (val !== undefined) {
				srcNode.detune.value = clamp(val, -1200, 1200);
			}
			return srcNode.detune.value;
		},

		volume(val: number): number {
			if (val !== undefined) {
				gainNode.gain.value = clamp(val, 0, 3);
			}
			return gainNode.gain.value;
		},

		loop() {
			srcNode.loop = true;
		},

		unloop() {
			srcNode.loop = false;
		},

		duration(): number {
			return sound.duration;
		},

		time(): number {
			return (stoppedTime ?? audio.ctx.currentTime) - startTime - emptyTime + seek;
		},

	};

	handle.speed(conf.speed);
	handle.detune(conf.detune);
	handle.volume(conf.volume);

	return handle;

}

/*

*555555*

math       *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

function deepCopy(input) {

	if (typeof(input) !== "object" || input === null) {
		return input;
	}

	const out = Array.isArray(input) ? [] : {};

	for (const key in input) {
		out[key] = deepCopy(input[key]);
	}

	return out;

}

/*

*666666*

game       *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

// TODO: comp registry?
// TODO: avoid comp fields direct assign / collision
// TODO: in-source doc on the component system

const DEF_GRAVITY = 980;
const DEF_ORIGIN = "topleft";

type Game = {
	loaded: boolean,
	scenes: Record<string, Scene>,
	curScene: string | null,
	nextScene: SceneSwitch | null,
	log: Log[],
};

type Log = {
	type: "log" | "error",
	msg: string,
}

type SceneSwitch = {
	name: string,
	args: any[],
};

type GameObj = {
	hidden: boolean,
	paused: boolean,
	exists: () => boolean,
	is: (tag: string | string[]) => boolean,
	use: (comp: any) => void,
	action: (cb: () => void) => void,
	on: (ev: string, cb: () => void) => void,
	trigger: (ev: string, ...args) => void,
	addTag: (t: string) => void,
	rmTag: (t: string) => void,
	_sceneID: number | null,
	_tags: string[],
	_events: {
		add: [],
		update: [],
		draw: [],
		destroy: [],
		debugInfo: [],
	},
};

type Timer = {
	time: number,
	cb: () => void,
};

type Camera = {
	pos: Vec2,
	scale: Vec2,
	angle: number,
	shake: number,
	ignore: string[],
	mpos: Vec2,
};

type TaggedEvent = {
	tag: string,
	cb: (...args) => void,
};

type KeyInputEvent = {
	key: string,
	cb: () => void,
};

type MouseInputEvent = {
	cb: () => void,
};

type CharInputEvent = {
	cb: (ch: string) => void,
};


type Scene = {
	init: (...args) => void,
	initialized: boolean,
	events: {
		add: TaggedEvent[],
		update: TaggedEvent[],
		draw: TaggedEvent[],
		destroy: TaggedEvent[],
		keyDown: KeyInputEvent[],
		keyPress: KeyInputEvent[],
		keyPressRep: KeyInputEvent[],
		keyRelease: KeyInputEvent[],
		mouseClick: MouseInputEvent[],
		mouseRelease: MouseInputEvent[],
		mouseDown: MouseInputEvent[],
		charInput: CharInputEvent[],
	},
	action: Array<() => void>,
	render: Array<() => void>,
	objs: Map<number, GameObj>,
	lastID: number,
	timers: Record<number, Timer>,
	lastTimerID: number,
	cam: Camera,
	gravity: number,
	layers: Record<string, number>,
	defLayer: string | null,
	data: any,
};

const game: Game = {
	loaded: false,
	scenes: {},
	curScene: null,
	nextScene: null,
	log: [],
};

// start describing a scene (this should be called before start())
function scene(name, cb) {

	game.scenes[name] = {

		init: cb,
		initialized: false,

		// event callbacks
		events: {
			add: [],
			update: [],
			draw: [],
			destroy: [],
			keyDown: [],
			keyPress: [],
			keyPressRep: [],
			keyRelease: [],
			mouseClick: [],
			mouseRelease: [],
			mouseDown: [],
			charInput: [],
		},

		action: [],
		render: [],

		// in game pool
		objs: new Map(),
		lastID: 0,
		timers: {},
		lastTimerID: 0,

		// cam
		cam: {
			pos: vec2(width() / 2, height() / 2),
			scale: vec2(1, 1),
			angle: 0,
			shake: 0,
			ignore: [],
			mpos: vec2(0),
		},

		// misc
		layers: {},
		defLayer: null,
		gravity: DEF_GRAVITY,
		data: {},

	};

}

function curScene(): Scene {
	return game.scenes[game.curScene];
}

// custom data kv store for scene
function sceneData(): any {
	return curScene().data;
}

// register inputs for controlling debug features
function regDebugInputs() {

	const dbg = debug;

	keyPress("`", () => {
		dbg.showLog = !dbg.showLog;
		log(`show log: ${dbg.showLog ? "on" : "off"}`);
	});

	keyPress("f1", () => {
		dbg.showArea = !dbg.showArea;
		log(`show area: ${dbg.showArea ? "on" : "off"}`);
	});

	keyPress("f2", () => {
		dbg.hoverInfo = !dbg.hoverInfo;
		log(`hover info: ${dbg.hoverInfo ? "on" : "off"}`);
	});

	keyPress("f8", () => {
		dbg.paused = !dbg.paused;
		log(`${dbg.paused ? "paused" : "unpaused"}`);
	});

	keyPress("f7", () => {
		dbg.timeScale = clamp(dbg.timeScale - 0.2, 0, 2);
		log(`time scale: ${dbg.timeScale.toFixed(1)}`);
	});

	keyPress("f9", () => {
		dbg.timeScale = clamp(dbg.timeScale + 0.2, 0, 2);
		log(`time scale: ${dbg.timeScale.toFixed(1)}`);
	});

	keyPress("f10", () => {
		stepFrame();
		log(`stepped frame`);
	});

}

// schedule to switch to a scene
function go(name: string, ...args) {
	game.nextScene = {
		name: name,
		args: [...args],
	};
}

function goSync(name: string, ...args) {
	reload(name);
	game.curScene = name;
	const scene = game.scenes[name];
	if (!scene) {
		error(`scene not found: '${name}'`);
		return;
	}
	if (!scene.initialized) {
		try {
			scene.init(...args);
		} catch (e) {
			error(e.stack);
		}
		if (gconf.debug) {
			regDebugInputs();
		}
		scene.initialized = true;
	}
}

// reload a scene, reset all objs to their init states
function reload(name: string) {
	if (!game.scenes[name]) {
		error(`scene not found: '${name}'`);
		return;
	}
	scene(name, game.scenes[name].init);
}

function layers(list: string[], def?: string) {

	const scene = curScene();

	if (!scene) {
		return;
	}

	const each = 0.5 / list.length;

	list.forEach((name, i) => {
		scene.layers[name] = 0.5 + each * i;
	});

	if (def) {
		scene.defLayer = def;
	}

}

function camPos(...pos): Vec2 {
	const cam = curScene().cam;
	if (pos.length > 0) {
		cam.pos = vec2(...pos);
	}
	return cam.pos.clone();
}

function camScale(...scale): Vec2 {
	const cam = curScene().cam;
	if (scale.length > 0) {
		cam.scale = vec2(...scale);
	}
	return cam.scale.clone();
}

function camRot(angle: number): number {
	const cam = curScene().cam;
	if (angle !== undefined) {
		cam.angle = angle;
	}
	return cam.angle;
}

function camShake(intensity: number) {
	const cam = curScene().cam;
	cam.shake = intensity;
}

function camIgnore(layers: string[]) {
	const cam = curScene().cam;
	cam.ignore = layers;
}

function add(comps: any[]): GameObj {

	const obj: GameObj = {

		hidden: false,
		paused: false,
		_tags: [],
		_sceneID: null,

		_events: {
			add: [],
			update: [],
			draw: [],
			destroy: [],
			debugInfo: [],
		},

		// use a comp
		use(comp) {

			if (comp === undefined) {
				return;
			}

			const type = typeof(comp);

			// tags
			if (type === "string") {
				this._tags.push(comp);
				return;
			}

			if (type !== "object") {
				error(`invalid comp type: ${type}`);
				return;
			}

			// multi comps
			if (Array.isArray(comp)) {
				for (const c of comp) {
					this.use(c);
				}
				return;
			}

			for (const k in comp) {

				// event / custom method
				if (typeof(comp[k]) === "function") {
					if (this._events[k]) {
						this._events[k].push(comp[k].bind(this));
					} else {
						this[k] = comp[k].bind(this);
					}
					continue;
				}

				// TODO: deal with getter / setters
				// fields
				this[k] = comp[k];

			}

		},

		// if obj is current in scene
		exists() {
			return this._sceneID !== undefined;
		},

		// if obj has certain tag
		is(tag) {
			if (tag === "*") {
				return true;
			}
			if (Array.isArray(tag)) {
				for (const t of tag) {
					if (!this._tags.includes(t)) {
						return false;
					}
				}
				return true;
			}
			return this._tags.includes(tag);
		},

		on(event, cb) {
			if (!this._events[event]) {
				this._events[event] = [];
			}
			this._events[event].push(cb);
		},

		action(cb) {
			this.on("update", cb);
		},

		trigger(event, ...args) {
			if (this._events[event]) {
				for (const f of this._events[event]) {
					f(...args);
				}
			}
			const scene = curScene();
			const events = scene.events[event];
			if (events) {
				for (const ev of events) {
					if (this.is(ev.tag)) {
						ev.cb(this);
					}
				}
			}
		},

		addTag(t) {
			if (this.is(t)) {
				return;
			}
			this._tags.push(t);
		},

		rmTag(t) {
			const idx = this._tags.indexOf(t);
			if (idx > -1) {
				this._tags.splice(idx, 1);
			}
		},

	};

	obj.use(comps);

	const scene = curScene();

	scene.objs.set(scene.lastID, obj);
	obj._sceneID = scene.lastID;
	scene.lastID++;

	obj.trigger("add");

	for (const e of scene.events.add) {
		if (obj.is(e.tag)) {
			e.cb(obj);
		}
	}

	return obj;

}

function readd(obj: GameObj) {

	if (!obj.exists()) {
		return;
	}

	const scene = curScene();

	scene.objs.delete(obj._sceneID);
	scene.objs.set(scene.lastID, obj);
	obj._sceneID = scene.lastID;
	scene.lastID++;

	return obj;

}

// add an event to a tag
function on(event, tag, cb) {
	const scene = curScene();
	if (!scene.events[event]) {
		scene.events[event] = [];
	}
	scene.events[event].push({
		tag: tag,
		cb: cb,
	});
}

// add update event to a tag or global update
function action(tag, cb) {
	if (typeof(tag) === "function" && cb === undefined) {
		curScene().action.push(tag);
	} else {
		on("update", tag, cb);
	}
}

// add draw event to a tag or global draw
function render(tag, cb) {
	if (typeof(tag) === "function" && cb === undefined) {
		curScene().render.push(tag);
	} else {
		on("update", tag, cb);
	}
}

// add an event that runs with objs with t1 collides with objs with t2
function collides(t1, t2, f) {
	action(t1, (o1) => {
		o1._checkCollisions(t2, (o2) => {
			f(o1, o2);
		});
	});
}

// add an event that runs with objs with t1 overlaps with objs with t2
function overlaps(t1, t2, f) {
	action(t1, (o1) => {
		o1._checkOverlaps(t2, (o2) => {
			f(o1, o2);
		});
	});
}

// add an event that runs when objs with tag t is clicked
function clicks(t, f) {
	action(t, (o) => {
		if (o.isClicked()) {
			f(o);
		}
	});
}

// add an event that'd be run after t
function wait(t, f) {
	if (f) {
		const scene = curScene();
		scene.timers[scene.lastTimerID] = {
			time: t,
			cb: f,
		};
		scene.lastTimerID++;
	} else {
		return new Promise(r => wait(t, r));
	}
}

// TODO: return control handle
// add an event that's run every t seconds
function loop(t, f) {
	const newF = () => {
		f();
		wait(t, newF);
	};
	newF();
}

function pushKeyEvent(e: string, k: string, f: () => void) {
	if (Array.isArray(k)) {
		for (const key of k) {
			pushKeyEvent(e, key, f);
		}
	} else {
		const scene = curScene();
		scene.events[e].push({
			key: k,
			cb: f,
		});
	}
}

// input callbacks
function keyDown(k: string, f: () => void) {
	pushKeyEvent("keyDown", k, f);
}

function keyPress(k: string, f: () => void) {
	pushKeyEvent("keyPress", k, f);
}

function keyPressRep(k: string, f: () => void) {
	pushKeyEvent("keyPressRep", k, f);
}

function keyRelease(k: string, f: () => void) {
	pushKeyEvent("keyRelease", k, f);
}

function charInput(f: (string) => void) {
	const scene = curScene();
	scene.events.charInput.push({
		cb: f,
	});
}

function mouseDown(f) {
	const scene = curScene();
	scene.events.mouseDown.push({
		cb: f,
	});
}

function mouseClick(f) {
	const scene = curScene();
	scene.events.mouseClick.push({
		cb: f,
	});
}

function mouseRelease(f) {
	const scene = curScene();
	scene.events.mouseRelease.push({
		cb: f,
	});
}

// get all objects with tag
function get(t?: string) {

	const scene = curScene();
	const objs = [...scene.objs.values()];

	if (!t) {
		return objs;
	} else {
		return objs.filter(obj => obj.is(t));
	}

}

// apply a function to all objects currently in scene with tag t
function every(t: string | ((GameObj) => void), f?: (GameObj) => void) {
	if (typeof(t) === "function" && f === undefined) {
		get().forEach(t);
	} else if (typeof t === "string") {
		get(t).forEach(f);
	}
}

// every but in reverse order
function revery(t: string | ((GameObj) => void), f?: (GameObj) => void) {
	if (typeof(t) === "function" && f === undefined) {
		get().reverse().forEach(t);
	} else if (typeof t === "string") {
		get(t).reverse().forEach(f);
	}
}

// destroy an obj
function destroy(obj) {

	if (!obj.exists()) {
		return;
	}

	const scene = curScene();

	if (!scene) {
		return;
	}

	obj.trigger("destroy");
	scene.objs.delete(obj._sceneID);
	delete obj._sceneID;

}

// destroy all obj with the tag
function destroyAll(t) {
	every(t, (obj) => {
		destroy(obj);
	});
}

// get / set gravity
function gravity(g?: number): number {
	const scene = curScene();
	if (g !== undefined) {
		scene.gravity = g;
	}
	return scene.gravity;
}

const LOG_TIME = 6;

// TODO: cleaner pause logic
function gameFrame(ignorePause?: boolean) {

	const scene = curScene();

	if (!scene) {
		error(`scene not found: '${game.curScene}'`);
		return;
	}

	const doUpdate = ignorePause || !debug.paused;

	if (doUpdate) {
		// update timers
		for (const id in scene.timers) {
			const t = scene.timers[id];
			t.time -= dt();
			if (t.time <= 0) {
				t.cb();
				delete scene.timers[id];
			}
		}
	}

	// update every obj
	revery((obj) => {
		if (!obj.paused && doUpdate) {
			obj.trigger("update");
		}
	});

	if (doUpdate) {
		for (const f of scene.action) {
			f();
		}
	}

	// calculate camera matrix
	const size = vec2(width(), height());
	const cam = scene.cam;
	const shake = vec2FromAngle(rand(0, Math.PI * 2)).scale(cam.shake);

	cam.shake = lerp(cam.shake, 0, 5);

	const camMat = mat4()
		.translate(size.scale(0.5))
		.scale(cam.scale)
		.rotateZ(cam.angle)
		.translate(size.scale(-0.5))
		.translate(cam.pos.scale(-1).add(size.scale(0.5)).add(shake))
		;

	cam.mpos = camMat.invert().multVec2(mousePos());

	// draw every obj
	every((obj) => {

		if (!obj.hidden) {

			pushTransform();

			if (!cam.ignore.includes(obj.layer)) {
				pushMatrix(camMat);
			}

			obj.trigger("draw");

			popTransform();

		}

	});

	for (const f of scene.render) {
		f();
	}

}

// TODO: make log and progress bar fixed size independent of global scale
function drawLog() {

	if (game.log.length > debug.logMax) {
		game.log = game.log.slice(0, debug.logMax);
	}

	const pos = vec2(0, height());

	if (debug.showLog) {
		// ...
	}

	const showingLogs = game.log.filter((log) => {
		if (debug.showLog) {
			return true;
		} else {
			return log.type === "error";
		}
	});

	showingLogs.forEach((log, i) => {

		const alpha = map(i, 0, debug.logMax, 1, 0.2);
		const alpha2 = map(i, 0, debug.logMax, 0.7, 0.2);

		const col = (() => {
			switch (log.type) {
				case "log": return rgba(1, 1, 1, alpha);
				case "error": return rgba(1, 0, 0.5, alpha);
			}
		})();

		const ftext = fmtText(log.msg, {
			pos: pos,
			origin: "botleft",
			color: col,
			z: 1,
		});

		drawRect(pos, ftext.width, ftext.height, {
			origin: "botleft",
			color: rgba(0, 0, 0, alpha2),
			z: 1,
		});

		drawFmtText(ftext);
		pos.y -= ftext.height;

	});

}

// TODO: on screen error message?
// start the game with a scene
// put main event loop in app module
function start(name, ...args) {

	let loopID;

	const frame = (t) => {

		let stopped = false;
		const realTime = t / 1000;
		const realDt = realTime - app.realTime;

		app.realTime = realTime;

		if (!app.skipTime) {
			app.dt = realDt * debug.timeScale;
			app.time += app.dt;
		}

		app.skipTime = false;
		gfxFrameStart();

		if (!game.loaded) {

			// if assets are not fully loaded, draw a progress bar

			const progress = loadProgress();

			if (progress === 1) {

				game.loaded = true;
				goSync(name, ...args);

			} else {

				const w = width() / 2;
				const h = 12;
				const pos = vec2(width() / 2, height() / 2).sub(vec2(w / 2, h / 2));

				drawRectStroke(pos, w, h, { width: 2, });
				drawRect(pos, w * progress, h);

			}

		} else {

			const scene = curScene();

			if (!scene) {
				error(`scene not found: '${game.curScene}'`);
				return;
			}

			for (const e of scene.events.charInput) {
				charInputted().forEach(e.cb);
			}

			// run input checks & callbacks
			for (const e of scene.events.keyDown) {
				if (keyIsDown(e.key)) {
					e.cb();
				}
			}

			for (const e of scene.events.keyPress) {
				if (keyIsPressed(e.key)) {
					e.cb();
				}
			}

			for (const e of scene.events.keyPressRep) {
				if (keyIsPressedRep(e.key)) {
					e.cb();
				}
			}

			for (const e of scene.events.keyRelease) {
				if (keyIsReleased(e.key)) {
					e.cb();
				}
			}

			for (const e of scene.events.mouseDown) {
				if (mouseIsDown()) {
					e.cb();
				}
			}

			for (const e of scene.events.mouseClick) {
				if (mouseIsClicked()) {
					e.cb();
				}
			}

			for (const e of scene.events.mouseRelease) {
				if (mouseIsReleased()) {
					e.cb();
				}
			}

			try {
				gameFrame();
			} catch (e) {
				error(e.stack);
				stopped = true;
			}

			drawLog();

			for (const k in app.keyStates) {
				app.keyStates[k] = processBtnState(app.keyStates[k]);
			}

			app.mouseState = processBtnState(app.mouseState);
			app.charInputted = [];

			if (game.nextScene) {
				goSync.apply(null, [ game.nextScene.name, ...game.nextScene.args, ]);
				game.nextScene = null;
			}

		}

		gfxFrameEnd();

		if (!stopped) {
			requestAnimationFrame(frame);
		}

	};

	requestAnimationFrame(frame);

}

/*

*7777777*

comps      *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

// TODO: have velocity here?
function pos(...args) {

	return {

		pos: vec2(...args),

		move(...args) {

			const p = vec2(...args);
			const dx = p.x * dt();
			const dy = p.y * dt();

			this.pos.x += dx;
			this.pos.y += dy;

		},

		debugInfo() {
			return {
				pos: `(${~~this.pos.x}, ${~~this.pos.y})`,
			};
		},

	};

}

// TODO: allow single number assignment
function scale(...args) {
	return {
		scale: vec2(...args),
		flipX(s) {
			this.scale.x = Math.sign(s) * Math.abs(this.scale.x);
		},
		flipY(s) {
			this.scale.y = Math.sign(s) * Math.abs(this.scale.y);
		},
	};
}

function rotate(r) {
	return {
		angle: r,
	};
}

function color(...args) {
	return {
		color: rgba(...args),
	};
}

function origin(o) {
	return {
		origin: o,
	};
}

function layer(z) {
	return {
		layer: z,
		debugInfo() {
			const scene = curScene();
			return {
				layer: this.layer || scene.defLayer,
			};
		},
	};
}

// TODO: active flag
// TODO: tell which size collides
// TODO: dynamic update when size change
function area(p1, p2) {

	const colliding = {};
	const overlapping = {};

	return {

		area: {
			p1: p1,
			p2: p2,
		},

		areaWidth() {
			const { p1, p2 } = this._worldArea();
			return p2.x - p1.x;
		},

		areaHeight() {
			const { p1, p2 } = this._worldArea();
			return p2.y - p1.y;
		},

		draw() {

			const showArea = debug.showArea;
			const hoverInfo = debug.hoverInfo;

			if (!showArea) {
				return;
			}

			let width = 2;
			const color = rgba(0, 1, 1, 1);
			const hovered = this.isHovered();

			if (hoverInfo && hovered) {
				width += 2;
			}

			const a = this._worldArea();
			const pos = vec2((a.p1.x + a.p2.x) / 2, (a.p1.y + a.p2.y) / 2);
			const w = a.p2.x - a.p1.x;
			const h = a.p2.y - a.p1.y;

			drawRectStroke(a.p1, a.p2.x - a.p1.x, a.p2.y - a.p1.y, {
				width: width / app.scale,
				color: color,
				z: 0.9,
			});

			const mpos = mousePos(this.layer || curScene().defLayer);

			if (hoverInfo && hovered) {

				const padding = vec2(6, 6).scale(1 / app.scale);
				let bw = 0;
				let bh = 0;
				const lines = [];

				const addLine = (txt) => {
					const ftxt = fmtText(txt, {
						size: 12 / app.scale,
						pos: mpos.add(vec2(padding.x, padding.y + bh)),
						z: 1,
					});
					lines.push(ftxt);
					bw = ftxt.width > bw ? ftxt.width : bw;
					bh += ftxt.height;
				};

				for (const tag of this._tags) {
					addLine(`"${tag}"`);
				}

				for (const debugInfo of this._events.debugInfo) {

					const info = debugInfo();

					for (const field in info) {
						addLine(`${field}: ${info[field]}`);
					}

				}

				bw += padding.x * 2;
				bh += padding.y * 2;

				// background
				drawRect(mpos, bw, bh, {
					color: rgba(0, 0, 0, 1),
					z: 1,
				});

				drawRectStroke(mpos, bw, bh, {
					width: (width - 2) / app.scale,
					color: rgba(0, 1, 1, 1),
					z: 1,
				});

				for (const line of lines) {
					drawFmtText(line);
				}

			}

		},

		clicks(f) {
			this.action(() => {
				if (this.isClicked()) {
					f();
				}
			});
		},

		isClicked() {
			return mouseIsClicked() && this.isHovered();
		},

		hovers(f) {
			this.action(() => {
				if (this.isHovered()) {
					f();
				}
			});
		},

		hasPt(pt) {
			const a = this._worldArea();
			return colRectPt({
				p1: a.p1,
				p2: a.p2,
			}, pt);
		},

		isHovered() {
			return this.hasPt(mousePos(this.layer || curScene().defLayer));
		},

		// push object out of other solid objects
		resolve() {

			const targets = [];

			every((other) => {

				if (other === this) {
					return;
				}

				if (!other.solid) {
					return;
				}

				if (!other.area) {
					return;
				}

				if (this.layer !== other.layer) {
					return;
				}

				const a1 = this._worldArea();
				const a2 = other._worldArea();

				if (!colRectRect(a1, a2)) {
					return;
				}

				const disLeft = a1.p2.x - a2.p1.x;
				const disRight = a2.p2.x - a1.p1.x;
				const disTop = a1.p2.y - a2.p1.y;
				const disBottom = a2.p2.y - a1.p1.y;
				const min = Math.min(disLeft, disRight, disTop, disBottom);

				let side;

				switch (min) {
					case disLeft:
						this.pos.x -= disLeft;
						side = "right";
						break;
					case disRight:
						this.pos.x += disRight;
						side = "left";
						break;
					case disTop:
						this.pos.y -= disTop;
						side = "bottom";
						break;
					case disBottom:
						this.pos.y += disBottom;
						side = "top";
						break;
				}

				targets.push({
					obj: other,
					side: side,
				});

			});

			return targets;

		},

		_checkCollisions(tag, f) {

			every(tag, (obj) => {
				if (this === obj) {
					return;
				}
				if (colliding[obj._sceneID]) {
					return;
				}
				if (this.isCollided(obj)) {
					f(obj);
					colliding[obj._sceneID] = obj;
				}
			});

			for (const id in colliding) {
				const obj = colliding[id];
				if (!this.isCollided(obj)) {
					delete colliding[id];
				}
			}

		},

		collides(tag, f) {
			this.action(() => {
				this._checkCollisions(tag, f);
			});
		},

		// TODO: repetitive with collides
		_checkOverlaps(tag, f) {

			every(tag, (obj) => {
				if (this === obj) {
					return;
				}
				if (overlapping[obj._sceneID]) {
					return;
				}
				if (this.isOverlapped(obj)) {
					f(obj);
					overlapping[obj._sceneID] = obj;
				}
			});

			for (const id in overlapping) {
				const obj = overlapping[id];
				if (!this.isOverlapped(obj)) {
					delete overlapping[id];
				}
			}

		},

		overlaps(tag, f) {
			this.action(() => {
				this._checkOverlaps(tag, f);
			});
		},

		// TODO: cache
		// TODO: use matrix mult for more accuracy and rotation?
		_worldArea() {

			const a = this.area;
			const pos = this.pos || vec2(0);
			const scale = this.scale || vec2(1);
			const p1 = pos.add(a.p1.dot(scale));
			const p2 = pos.add(a.p2.dot(scale));

			const area = {
				p1: vec2(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y)),
				p2: vec2(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)),
			};

			return area;

		},

		isCollided(other) {

			if (!other.area) {
				return false;
			}

			if (this.layer !== other.layer) {
				return false;
			}

			const a1 = this._worldArea();
			const a2 = other._worldArea();

			return colRectRect(a1, a2);

		},

		isOverlapped(other) {

			if (!other.area) {
				return false;
			}

			if (this.layer !== other.layer) {
				return false;
			}

			const a1 = this._worldArea();
			const a2 = other._worldArea();

			return overlapRectRect(a1, a2);

		},

	};

}

function getAreaFromSize(w, h, o) {
	const size = vec2(w, h);
	const offset = originPt(o || DEF_ORIGIN).dot(size).scale(-0.5);
	return area(
		offset.sub(size.scale(0.5)),
		offset.add(size.scale(0.5)),
	);
}

type AddEvent = () => void;
type DrawEvent = () => void;
type UpdateEvent = () => void;
type DestroyEvent = () => void;

type SpriteCompConf = {
	noArea?: boolean,
	quad?: Quad,
	frame?: number,
	animSpeed?: number,
};

type SpriteComp = {
	add: AddEvent,
	draw: DrawEvent,
	update: UpdateEvent,
	width: number,
	height: number,
	animSpeed: number,
	frame: number,
	quad: Quad,
	play: (anim: string, loop?: boolean) => void,
	stop: () => void,
	changeSprite: (id: string) => void,
	numFrames: () => number,
	curAnim: () => string,
	onAnimPlay: (name: string, cb: () => void) => void,
	onAnimEnd: (name: string, cb: () => void) => void,
	debugInfo: () => SpriteCompDebugInfo,
};

type SpriteCompDebugInfo = {
	curAnim?: string,
};

function sprite(id: string, conf: SpriteCompConf = {}): SpriteComp {

	let spr = assets.sprites[id];

	if (!spr) {
		error(`sprite not found: "${id}"`);
		return;
	}

	const q = { ...spr.frames[0] };

	if (conf.quad) {
		q.x += conf.quad.x * q.w;
		q.y += conf.quad.y * q.h;
		q.w *= conf.quad.w;
		q.h *= conf.quad.h;
	}

	const width = spr.tex.width * q.w;
	const height = spr.tex.height * q.h;
	let curAnim = null;
	const events = {};

	return {

		width: width,
		height: height,
		animSpeed: conf.animSpeed || 0.1,
		frame: conf.frame || 0,
		quad: conf.quad || quad(0, 0, 1, 1),

		add() {
			// add default area
			if (!this.area && !conf.noArea) {
				this.use(getAreaFromSize(this.width, this.height, this.origin));
			}
		},

		draw() {

			const scene = curScene();
			const q = spr.frames[this.frame];

			drawSprite(spr, {
				pos: this.pos,
				scale: this.scale,
				rot: this.angle,
				color: this.color,
				frame: this.frame,
				origin: this.origin,
				quad: this.quad,
				z: scene.layers[this.layer || scene.defLayer],
			});

		},

		update() {

			if (!curAnim) {
				return;
			}

			const anim = spr.anims[curAnim.name];

			curAnim.timer += dt();

			if (curAnim.timer >= this.animSpeed) {
				// TODO: anim dir
				this.frame++;
				if (this.frame > anim[1]) {
					if (curAnim.loop) {
						this.frame = anim[0];
					} else {
						this.frame--;
						this.stop();
					}
				}
				curAnim.timer -= this.animSpeed;
			}

		},

		play(name, loop = true) {

			const anim = spr.anims[name];

			if (!anim) {
				error(`anim not found: ${name}`);
				return;
			}

			if (curAnim) {
				this.stop();
			}

			curAnim = {
				name: name,
				loop: loop,
				timer: 0,
			};

			this.frame = anim[0];

			if (events[name]?.play) {
				events[name].play();
			}

		},

		stop() {
			if (!curAnim) {
				return;
			}
			const cb = events[curAnim.name]?.end;
			curAnim = null;
			cb && cb();
		},

		changeSprite(id) {

			spr = assets.sprites[id];

			const q = { ...spr.frames[0] };

			if (conf.quad) {
				q.x += conf.quad.x * q.w;
				q.y += conf.quad.y * q.h;
				q.w *= conf.quad.w;
				q.h *= conf.quad.h;
			}

			this.width = spr.tex.width * q.w;
			this.height = spr.tex.height * q.h;

			if (this.area && !conf.noArea) {
				this.use(getAreaFromSize(this.width, this.height, this.origin));
			}

			curAnim = null;
			this.frame = 0;

		},

		numFrames() {
			return spr.frames.length;
		},

		curAnim() {
			return curAnim?.name;
		},

		onAnimPlay(name, cb) {
			if (!events[name]) {
				events[name] = {};
			}
			events[name].play = cb;
		},

		onAnimEnd(name, cb) {
			if (!events[name]) {
				events[name] = {};
			}
			events[name].end = cb;
		},

		debugInfo(): SpriteCompDebugInfo {
			const info: SpriteCompDebugInfo = {};
			if (curAnim) {
				info.curAnim = `"${curAnim.name}"`;
			}
			return info;
		},

	};

}

type TextComp = {
	add: AddEvent,
	draw: DrawEvent,
	text: string,
	textSize: number,
	font: string,
	width: number,
	height: number,
};

type TextCompConf = {
	noArea?: boolean,
	font?: string,
	width?: number,
};

// TODO: add area
function text(t: string, size: number, conf: TextCompConf = {}): TextComp {

	return {

		text: t,
		textSize: size,
		font: conf.font,
		// TODO: calc these at init
		width: 0,
		height: 0,

		add() {
			// add default area
			if (!this.area && !conf.noArea) {
				const scene = curScene();
				const ftext = fmtText(this.text + "", {
					pos: this.pos,
					scale: this.scale,
					rot: this.angle,
					size: this.textSize,
					origin: this.origin,
					color: this.color,
					font: this.font,
					width: conf.width,
					z: scene.layers[this.layer || scene.defLayer],
				});
				this.width = ftext.width / (this.scale?.x || 1);
				this.height = ftext.height / (this.scale?.y || 1);
				this.use(getAreaFromSize(this.width, this.height, this.origin));
			}
		},

		draw() {

			const scene = curScene();

			const ftext = fmtText(this.text + "", {
				pos: this.pos,
				scale: this.scale,
				rot: this.angle,
				size: this.textSize,
				origin: this.origin,
				color: this.color,
				font: this.font,
				width: conf.width,
				z: scene.layers[this.layer || scene.defLayer],
			});

			this.width = ftext.width;
			this.height = ftext.height;

			drawFmtText(ftext);

		},

	};

}

type RectComp = {
	add: AddEvent,
	draw: DrawEvent,
	width: number,
	height: number,
};

type RectCompConf = {
	noArea?: boolean,
};

function rect(
	w: number,
	h: number,
	conf: RectCompConf = {},
): RectComp {

	return {

		width: w,
		height: h,

		add() {
			// add default area
			if (!this.area && !conf.noArea) {
				this.use(getAreaFromSize(this.width, this.height, this.origin));
			}
		},

		draw() {

			const scene = curScene();

			drawRect(this.pos, this.width, this.height, {
				scale: this.scale,
				rot: this.angle,
				color: this.color,
				origin: this.origin,
				z: scene.layers[this.layer || scene.defLayer],
			});

		},

	};

}

type SolidComp = {
	solid: boolean,
};

function solid(): SolidComp {
	return {
		solid: true,
	};
}

// maximum y velocity with body()
const DEF_MAX_VEL = 960;
const DEF_JUMP_FORCE = 480;

type BodyComp = {
	update: UpdateEvent,
	jumpForce: number,
	curPlatform: () => GameObj | undefined,
	grounded: () => boolean,
	jump: (f: number) => void,
};

type BodyCompConf = {
	jumpForce?: number,
	maxVel?: number,
};

function body(conf: BodyCompConf = {}): BodyComp {

	let velY = 0;
	let curPlatform = null;
	const maxVel = conf.maxVel ?? DEF_MAX_VEL;

	return {

		jumpForce: conf.jumpForce ?? DEF_JUMP_FORCE,

		update() {

			this.move(0, velY);

			const targets = this.resolve();
			let justOff = false;

			// check if loses current platform
			if (curPlatform) {
				if (!curPlatform.exists() || !this.isCollided(curPlatform)) {
					curPlatform = null;
					justOff = true;
				}
			}

			if (!curPlatform) {

				velY = Math.min(velY + gravity() * dt(), maxVel);

				// check if grounded to a new platform
				for (const target of targets) {
					if (target.side === "bottom" && velY > 0) {
						curPlatform = target.obj;
						velY = 0;
						if (!justOff) {
							this.trigger("grounded", curPlatform);
						}
					} else if (target.side === "top" && velY < 0) {
						velY = 0;
						this.trigger("headbump", target.obj);
					}
				}

			}

		},

		curPlatform() {
			return curPlatform;
		},

		grounded() {
			return curPlatform !== null;
		},

		jump(force) {
			curPlatform = null;
			velY = -force || -this.jumpForce;
		},

	};

}

/*

*8888888*

debug     *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

type DebugState = {
	paused: boolean,
	timeScale: number,
	showArea: boolean,
	hoverInfo: boolean,
	showLog: boolean,
	logMax: number,
};

const debug: DebugState = {
	paused: false,
	timeScale: 1,
	showArea: false,
	hoverInfo: false,
	showLog: false,
	logMax: 8,
};

function dbg(): DebugState {
	return debug;
}

function fps(): number {
	return 1.0 / dt();
}

function objCount(): number {
	const scene = curScene();
	return scene.objs.size;
}

function stepFrame() {
	gameFrame(true);
}

function error(msg: string) {
	console.error(msg);
	game.log.unshift({
		type: "error",
		msg: msg,
	});
}

function log(msg: string) {
	console.log(msg);
	game.log.unshift({
		type: "log",
		msg: msg,
	});
}

/*

*99999999*

helper    *                     .            ~       +    .
    .           .            ~          +
            +          .                          .
              .                      .
 @      .        ~           .                 @            +
                                       +
     .                                                 ~
         ~            +           +
              +                .      .               +
      ~                   .                 +               ~
   .       @        .                   ~           .
                               .                           .

*/

type LevelConf = {
	width: number,
	height: number,
	pos?: Vec2,
	any: (s: string) => void,
};

type Level = {
	getPos: (p: Vec2) => Vec2,
	spawn: (sym: string, p: Vec2) => void,
	width: () => number,
	height: () => number,
	destroy: () => void,
};

function addLevel(map: string[], conf: LevelConf): Level {

	const objs = [];
	const offset = vec2(conf.pos);
	let longRow = 0;

	const level = {

		getPos(...args) {
			const p = vec2(...args);
			return vec2(
				offset.x + p.x * conf.width,
				offset.y + p.y * conf.height
			);
		},

		spawn(sym: string, p: Vec2) {

			const comps = (() => {
				if (Array.isArray(sym)) {
					return sym;
				} else if (conf[sym]) {
					if (typeof(conf[sym]) === "function") {
						return conf[sym]();
					} else if (Array.isArray(conf[sym])) {
						return [...conf[sym]];
					}
				} else if (conf.any) {
					return conf.any(sym);
				}
			})();

			if (comps) {

				comps.push(pos(
					offset.x + p.x * conf.width,
					offset.y + p.y * conf.height
				));

				const obj = add(comps);

				objs.push(obj);

				obj.use({

					gridPos: p.clone(),

					setGridPos(p) {
						this.gridPos = p.clone();
						this.pos = vec2(
							offset.x + this.gridPos.x * conf.width,
							offset.y + this.gridPos.y * conf.height
						);
					},

					moveLeft() {
						this.setGridPos(this.gridPos.add(vec2(-1, 0)));
					},

					moveRight() {
						this.setGridPos(this.gridPos.add(vec2(1, 0)));
					},

					moveUp() {
						this.setGridPos(this.gridPos.add(vec2(0, -1)));
					},

					moveDown() {
						this.setGridPos(this.gridPos.add(vec2(0, 1)));
					},

				});

			}

		},

		width() {
			return longRow * conf.width;
		},

		height() {
			return map.length * conf.height;
		},

		destroy() {
			for (const obj of objs) {
				destroy(obj);
			}
		},

	};

	map.forEach((row, i) => {

		const syms = row.split("");

		longRow = Math.max(syms.length, longRow);

		syms.forEach((sym, j) => {
			level.spawn(sym, vec2(j, i));
		});

	});

	return level;

}

const lib = {
	start,
	// asset load
	loadRoot,
	loadSprite,
	loadSound,
	loadFont,
	newLoader,
	// query
	width,
	height,
	dt,
	time,
	screenshot,
	// scene
	scene,
	go,
	sceneData,
	// misc
	layers,
	camPos,
	camScale,
	camRot,
	camShake,
	camIgnore,
	gravity,
	// obj
	add,
	readd,
	destroy,
	destroyAll,
	get,
	every,
	// comps
	pos,
	scale,
	rotate,
	color,
	origin,
	layer,
	area,
	sprite,
	text,
	rect,
	solid,
	body,
	// group events
	on,
	action,
	render,
	collides,
	overlaps,
	clicks,
	// input
	keyDown,
	keyPress,
	keyPressRep,
	keyRelease,
	charInput,
	mouseDown,
	mouseClick,
	mouseRelease,
	mousePos,
	keyIsDown,
	keyIsPressed,
	keyIsPressedRep,
	keyIsReleased,
	mouseIsDown,
	mouseIsClicked,
	mouseIsReleased,
	// timer
	loop,
	wait,
	// audio
	play,
	volume,
	// math
	makeRng,
	rand,
	randSeed,
	vec2,
	rgb,
	rgba,
	quad,
	choose,
	chance,
	lerp,
	map,
	wave,
	// raw draw
	drawSprite,
	drawText,
	drawRect,
	drawRectStroke,
	drawLine,
	drawPoly,
	drawCircle,
	// debug
	dbg,
	objCount,
	fps,
	stepFrame,
	log,
	error,
	// level
	addLevel,
};

if (gconf.plugins) {
	for (const src of gconf.plugins) {
		const map = src(lib);
		for (const k in map) {
			lib[k] = map[k];
		}
	}
}

if (gconf.global) {
	for (const k in lib) {
		window[k] = lib[k];
	}
}

appInit();

return lib;

};
