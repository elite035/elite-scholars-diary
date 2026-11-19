import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serializeRender} from '../public/render-queue.js';
test('overlapping navigation renders complete in sequence without duplicate appended panels',async()=>{
 let release;const gate=new Promise(r=>release=r),events=[];let draws=0,panels=0;
 const render=serializeRender(async()=>{const n=++draws;events.push('start '+n);panels=0;if(n===1)await gate;panels++;events.push('end '+n);});
 const first=render();await Promise.resolve();const second=render();assert.deepEqual(events,['start 1']);release();await Promise.all([first,second]);assert.deepEqual(events,['start 1','end 1','start 2','end 2']);assert.equal(panels,1);
});
test('a failed page render does not prevent subsequent navigation',async()=>{
 let calls=0;const render=serializeRender(async()=>{if(++calls===1)throw Error('Temporary request failure');return 'Recovered page';});await assert.rejects(render(),/Temporary request failure/);assert.equal(await render(),'Recovered page');
});
