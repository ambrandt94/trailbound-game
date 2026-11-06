/* Controller boot order. Character Forge, minigames, and the light lab stay out.
   Each module registers its window.TB* API as it evaluates.
   Imported after the WebGLRenderer exists so texture setup can see TBRenderer.
*/
import './assets.js';
import './kit_catalog.js';
import './tiles.js';
import './avatar.js';
import './life.js';
import './places.js';
import './buildings.js';
import './props.js';
import './interiors.js';
import './live.js';
import './npcs.js';
import './crowd.js';
import './crowdai.js';
import './area.js';
import './visuals.js';
