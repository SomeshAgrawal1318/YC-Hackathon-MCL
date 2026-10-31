// npm run actors:dev      — start the Durable Actors server in WSL (keeps running) and generate its client
// npm run actors:generate — regenerate actors/generated after changing actors/src (server must be up)
// npm run actors:stop     — stop the server (needed after changing .env.local)
// npm run actors:reset    — stop the server and delete all actor state (shadow results, approvals)
import actorsMod from '../electron/actors.cjs';
import envMod from '../electron/env.cjs';

const { ensureActors, stopActors, generate } = actorsMod;
const env = envMod.loadEnv();
const cmd = process.argv[2] || 'dev';

if (cmd === 'stop' || cmd === 'reset') {
  stopActors(env);
  console.log('Stopped the actors server.');
  if (cmd === 'reset') {
    const { spawnSync } = await import('node:child_process');
    spawnSync('wsl.exe', ['-d', env.WSL_DISTRO, '--exec', 'bash', '-c', 'rm -rf "$HOME/.mcl-actors"'], { stdio: 'inherit' });
    console.log('Deleted the actor state (~/.mcl-actors in WSL).');
  }
  process.exit(0);
}

if (cmd === 'dev') {
  const up = await ensureActors({ env, log: console.log });
  if (!up) {
    console.error('The actors server did not come up within 2 minutes. In WSL, check: tail -n 50 ~/.mcl-actors.log');
    process.exit(1);
  }
  console.log(`Actors server is up: ${env.ACTORS_URL}`);
}

// Fresh client for this version of actors/src (the server may still be building it right after a start).
for (let i = 0; ; i++) {
  try {
    console.log(generate(env));
    break;
  } catch (e) {
    if (i >= 5) {
      console.error(e.message);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
process.exit(0);
