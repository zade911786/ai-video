console.log("🎪 MAIN START");

document.body.innerHTML += `
<div style="
position:fixed;
top:20px;
left:20px;
z-index:999999;
background:#111;
color:#5cff87;
padding:20px;
font-family:monospace;
border:2px solid #5cff87;
">
✅ MAIN.JS RUNNING
</div>
`;

import("./world.js")
.then(mod => {

  console.log("✅ world.js imported");

  document.body.innerHTML += `
  <div style="
  position:fixed;
  top:120px;
  left:20px;
  z-index:999999;
  background:#111;
  color:#5cff87;
  padding:20px;
  font-family:monospace;
  border:2px solid #5cff87;
  ">
  ✅ WORLD IMPORTED
  </div>
  `;

  const container = document.getElementById("canvas-container");

  const world = new mod.World(container);

  console.log("✅ WORLD CREATED");

  document.body.innerHTML += `
  <div style="
  position:fixed;
  top:220px;
  left:20px;
  z-index:999999;
  background:#111;
  color:#5cff87;
  padding:20px;
  font-family:monospace;
  border:2px solid #5cff87;
  ">
  ✅ WORLD CREATED
  </div>
  `;

  function animate(){

    requestAnimationFrame(animate);

    world.updateFloaters(0.016);
    world.render();

  }

  animate();

})
.catch(err => {

  console.error(err);

  document.body.innerHTML += `
  <div style="
  position:fixed;
  top:20px;
  left:20px;
  right:20px;
  z-index:999999;
  background:#300;
  color:#ff8080;
  padding:20px;
  font-family:monospace;
  white-space:pre-wrap;
  border:2px solid red;
  ">
  ❌ ERROR

  ${err.stack || err}
  </div>
  `;

});
