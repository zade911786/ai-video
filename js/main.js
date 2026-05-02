console.log("🎪 MAIN START");

async function testImport(path) {

  try {

    console.log("📦 IMPORTING:", path);

    const mod = await import(path);

    console.log("✅ SUCCESS:", path);

    document.body.innerHTML += `
      <div style="
        background:#111;
        color:#5cff87;
        padding:10px;
        margin:10px;
        border:1px solid #5cff87;
        font-family:monospace;
      ">
        ✅ SUCCESS: ${path}
      </div>
    `;

    return mod;

  } catch (err) {

    console.error("❌ FAILED:", path, err);

    document.body.innerHTML += `
      <div style="
        background:#111;
        color:#ff8080;
        padding:20px;
        margin:20px;
        border:2px solid red;
        font-family:monospace;
        overflow:auto;
      ">
        <h2>❌ FAILED IMPORT</h2>

        <pre>${path}</pre>

        <hr>

        <pre>${err.message}</pre>

        <hr>

        <pre>${err.stack || err}</pre>
      </div>
    `;

    throw err;
  }
}

try {

  // CORE
  await testImport('./world.js');

  await testImport('./ai/agent.js');

  await testImport('./ai/brain.js');

  await testImport('./ai/curriculum.js');

  await testImport('./ai/evolution.js');

  // SIM
  await testImport('./sim/multiSim.js');

  await testImport('./sim/megaTrain.js');

  await testImport('./sim/headlessSims.js');

  // GAMES
  await testImport('./games/worldGame.js');

  await testImport('./games/flappyGame.js');

  await testImport('./games/mazeGame.js');

  await testImport('./games/sandboxGame.js');

  await testImport('./games/escapeGame.js');

  // UI
  await testImport('./ui.js');

  await testImport('./save.js');

  document.body.innerHTML += `
    <div style="
      background:#000;
      color:#5cff87;
      padding:30px;
      margin:20px;
      border:3px solid #5cff87;
      font-size:24px;
      font-family:monospace;
    ">
      ✅ ALL IMPORTS SUCCESSFUL
    </div>
  `;

} catch (e) {

  console.error("💥 MAIN CRASH:", e);

}
