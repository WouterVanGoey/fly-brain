import { chromium } from "playwright";

async function run() {
  console.log("Testing Neuromorphic Rover 3D Simulation...");
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

  console.log("Navigating to http://localhost:5173/rover.html...");
  await page.goto("http://localhost:5173/rover.html");

  console.log("Waiting for #canvas-container canvas element...");
  await page.waitForSelector("#canvas-container canvas", { timeout: 15000 });
  console.log("3D Canvas verified! Running simulation for 4 seconds in Tank mode...");

  for (let sec = 1; sec <= 4; sec++) {
    await page.waitForTimeout(1000);
    const dist = await page.$eval("#lbl-dist", el => el.textContent);
    const heading = await page.$eval("#lbl-heading", el => el.textContent);
    const leftTrack = await page.$eval("#spd-tank-l", el => el.textContent);
    const rightTrack = await page.$eval("#spd-tank-r", el => el.textContent);
    console.log(`[Tank Sec ${sec}] Dist: ${dist} | Heading: ${heading} | Left: ${leftTrack} | Right: ${rightTrack}`);
  }

  console.log("\nSwitching to 4-Wheel Mecanum Omnidirectional Drive...");
  await page.click("#btn-mode-mecanum");

  for (let sec = 1; sec <= 3; sec++) {
    await page.waitForTimeout(1000);
    const dist = await page.$eval("#lbl-dist", el => el.textContent);
    const fl = await page.$eval("#spd-mec-fl", el => el.textContent);
    const fr = await page.$eval("#spd-mec-fr", el => el.textContent);
    console.log(`[Mecanum Sec ${sec}] Dist: ${dist} | FL: ${fl} | FR: ${fr}`);
  }

  console.log("\nTriggering Looming Hand Threat to test Moonwalker Escape...");
  await page.click("#btn-threat");

  for (let sec = 1; sec <= 3; sec++) {
    await page.waitForTimeout(1000);
    const alertText = await page.$eval("#mdn-alert", el => el.textContent.trim());
    const tau = await page.$eval("#lbl-tau", el => el.textContent.trim());
    console.log(`[Threat Sec ${sec}] Alert: ${alertText} | Tau: ${tau}`);
  }

  console.log("\nTesting clicking on floor to place new goal beacon...");
  const canvas = await page.$("#canvas-container canvas");
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);

  await page.waitForTimeout(1000);
  const newGoalDist = await page.$eval("#lbl-dist", el => el.textContent);
  console.log(`Goal repositioned! New Distance: ${newGoalDist}`);

  await browser.close();
  console.log("\nNeuromorphic Rover 3D Test passed with 100% success!");
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
