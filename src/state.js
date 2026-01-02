import { CFG } from "./config.js";

export function createState() {
  return {
    time: 0,
    chickens: [],
    seeds: [],
    featherPuffs: [],
    respawns: [], // { t, chicken }
    nextSeedId: 1,
    coop: {
      x: 0,
      y: 0,
      w: CFG.COOP_SIZE,
      h: CFG.COOP_SIZE,
      wall: CFG.COOP_WALL,
      doorW: CFG.COOP_DOOR_W,
      doorDepth: CFG.COOP_DOOR_DEPTH,
      evacuated: false, // Coop evacuation state
      evacuationTimer: 0, // Timer for evacuation duration
    },
    input: {
      mouseX: 0,
      mouseY: 0,
      mouseDown: false,
    },
    canvas: {
      width: CFG.W,
      height: CFG.H,
      dpr: 1,
    }
  };
}
