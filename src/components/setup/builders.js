import { buildKeyboard, buildMic, buildMouse, buildMousepad, buildSetup } from './desk.js'
import { buildBoard, buildCpu, buildDisplays, buildGpu, buildPc, buildRam, buildSsd, buildWifi } from './models.js'

/* Every model of the showcase by tab id (the software tab has none). */
export const BUILDERS = {
  setup: buildSetup,
  pc: buildPc,
  cpu: buildCpu,
  gpu: buildGpu,
  ram: buildRam,
  board: buildBoard,
  ssd: buildSsd,
  wifi: buildWifi,
  displays: buildDisplays,
  keyboard: buildKeyboard,
  mouse: buildMouse,
  mousepad: buildMousepad,
  mic: buildMic,
}
