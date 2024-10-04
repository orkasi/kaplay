kaplay({ scale: 0.5 });
loadSprite("bean", "/sprites/bean.png");
loadSprite("grass", "/sprites/grass.png");
setGravity(400);
const level = addLevel([
    "@       =     ",
    "=======       ",
    "      =       ",
    "      =========",
], {
    tileWidth: 64,
    tileHeight: 64,
    pos: vec2(100, 200),
    tiles: {
        "@": () => [
            sprite("bean"),
            area({ friction: 0.125 }),
            body(),
            anchor("bot"),
            "player",
        ],
        "=": () => [
            sprite("grass"),
            area({ friction: 0.125 }),
            body({ isStatic: true }),
            anchor("bot"),
        ],
    },
});

const player = level.get("player")[0];
player.vel.x = 480;
debug.log(player.friction);
