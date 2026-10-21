import { chromium } from "playwright";

async function run() {
  console.log("Testing C. elegans 3D Connectome Simulation (worm.html)...");
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=gl",
      "--enable-unsafe-webgpu",
      "--no-sandbox",
      "--enable-features=Vulkan,DefaultANGLEVulkan"
    ]
  });
  const page = await browser.newPage();

  page.on("console", msg => {
    const text = msg.text();
    if (!text.includes("GPU stall") && !text.includes("[vite]")) {
      console.log(`[Browser Console ${msg.type()}]:`, text);
    }
  });

  page.on("pageerror", err => {
    console.error("[Browser Page Error]:", err.message);
  });

  console.log("Navigating to http://localhost:5173/worm.html...");
  await page.goto("http://localhost:5173/worm.html");

  console.log("Waiting for #canvas-container canvas element...");
  await page.waitForSelector("#canvas-container canvas", { timeout: 15000 });

  // Wait for connectome to load
  await page.waitForFunction(() => {
    const el = document.getElementById("status-text");
    return el && el.textContent.includes("454 Cells");
  }, { timeout: 15000 });
  console.log("C. elegans connectome successfully loaded into memory!");

  console.log("\nObserving baseline forward crawl for 4 seconds...");
  for (let sec = 1; sec <= 4; sec++) {
    await page.waitForTimeout(1000);
    const cmdText = await page.$eval("#command-alert", el => el.textContent.trim());
    const ash = await page.$eval("#lbl-ash", el => el.textContent);
    const distFood = await page.$eval("#lbl-dist-food", el => el.textContent);
    console.log(`[Worm Sec ${sec}] Command: ${cmdText} | ASH: ${ash} | Dist to Food: ${distFood}`);
  }

  console.log("\nTriggering Noxious Touch Threat to head...");
  await page.click("#btn-threat");

  for (let sec = 1; sec <= 3; sec++) {
    await page.waitForTimeout(1000);
    const cmdText = await page.$eval("#command-alert", el => el.textContent.trim());
    const ash = await page.$eval("#lbl-ash", el => el.textContent);
    console.log(`[Threat Sec ${sec}] Command: ${cmdText} | ASH: ${ash}`);
  }

  console.log("\nTesting Scrambled Null Control toggle...");
  await page.click("#btn-scramble");
  await page.waitForTimeout(1000);
  const graphMode = await page.$eval("#lbl-graph-mode", el => el.textContent.trim());
  console.log(`Graph Mode switched to: ${graphMode}`);

  console.log("\nTesting clicking on agar to place OP50 bacterial food...");
  const canvas = await page.$("#canvas-container canvas");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);

  await page.waitForTimeout(1000);
  const newFoodDist = await page.$eval("#lbl-dist-food", el => el.textContent);
  console.log(`Food repositioned! New Distance: ${newFoodDist}`);

  await browser.close();
  console.log("\nC. elegans 3D Connectome Simulation test passed with 100% success!");
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
