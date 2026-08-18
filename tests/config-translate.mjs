/* Translation layer: does a config from one front end configure the other? */
import fs from 'node:fs';
const T = (new Function('module','var window={};' +
  fs.readFileSync('../website/config-translate.js','utf8') +
  ';return module.exports||window.ConfigTranslate;'))({exports:null});

let pass=0, fail=0;
const ok=(c,l)=>{ c?pass++:(fail++,console.log('  FAIL: '+l)); };

// 1. walkthrough -> generator -> walkthrough is stable for mapped fields
const wl = { firmware:'uefi', filesystem:'btrfs', disk:'/dev/nvme0n1',
             bootloader:'grub', encryption:'luks2', microcode:'intel-ucode',
             libre:'no', desktop:'hyprland', apps:['git','neovim'],
             hostname:'box', username:'me' };  // last two are walkthrough-only
const toGen = T.walkthroughToGenerator(wl);
ok(toGen.answers.selects.firmware==='uefi', 'firmware -> generator');
ok(toGen.answers.inputs['target-disk']==='/dev/nvme0n1', 'disk -> generator inputs');
ok(toGen.answers.selects.partitioning==='luks2', 'luks2 -> partitioning');
ok(toGen.answers.selects.cpu_brand==='intel', 'intel-ucode -> intel');
ok(toGen.answers.selects.software_type==='proprietary', 'libre:no -> proprietary');
ok(toGen.unmapped.includes('hostname'), 'walkthrough-only field reported unmapped');

const back = T.generatorToWalkthrough(toGen.answers);
['firmware','filesystem','disk','bootloader','encryption','microcode','libre','desktop']
  .forEach(k => ok(back.answers[k]===wl[k], `round-trip ${k}: ${back.answers[k]} vs ${wl[k]}`));

// 2. idempotency: translating twice equals translating once
const twice = T.walkthroughToGenerator(T.generatorToWalkthrough(toGen.answers).answers);
ok(JSON.stringify(twice.answers.selects)===JSON.stringify(toGen.answers.selects),
   'translate is idempotent');

// 3. never invent: unspecified fields stay unset
const sparse = T.walkthroughToGenerator({ firmware:'uefi' });
ok(!('partitioning' in sparse.answers.selects), 'unspecified encryption not invented');
ok(Object.keys(sparse.answers.inputs).length===0, 'unspecified disk not invented');

// 4. never guess a destructive setting: unknown encryption value is left unset
const weird = T.walkthroughToGenerator({ encryption:'something-new' });
ok(!('partitioning' in weird.answers.selects), 'unknown encryption left unset, not guessed');
ok(weird.unmapped.some(u=>u.startsWith('encryption=')), 'unknown encryption reported');

// 5. envelope passthrough when already correct shape
const env = { schema:'unix-sit/config', version:2, source:'manual-walkthrough', answers:wl };
ok(T.translateEnvelope(env,'manual-walkthrough').translated===false, 'no-op when shape matches');
ok(T.translateEnvelope(env,'dynamic-generator').translated===true, 'translates when shape differs');

/* 6. the name the project used before it became Unix-SIT.
   Every configuration the site has handed out so far carries it, and those are
   files people keep. Dropping it would turn a repository rename into a saved
   install that silently stops loading. */
const legacy = { schema:'unix-guides-dynamic/config', version:2,
                 source:'manual-walkthrough', answers:wl };
ok(T.translateEnvelope(legacy,'manual-walkthrough').translated===false,
   'a config saved under the old project name is no longer recognised');
ok(T.translateEnvelope(legacy,'dynamic-generator').translated===true,
   'a config saved under the old project name no longer translates');
ok(T.walkthroughToGenerator(wl).answers.schema === 'unix-sit/config',
   'the translator still writes the retired schema id');

console.log(`\nconfig-translate: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
