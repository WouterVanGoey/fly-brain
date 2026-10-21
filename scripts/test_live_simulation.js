import { chromium } from "playwright";

async function run() {
  console.log("Launching Chrome with WebGPU enabled...");
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
    if (!text.includes("GPU stall")) {
      console.log(`[Browser Console ${msg.type()}]:`, text);
    }
  });

  page.on("pageerror", err => {
    console.error("[Browser Page Error]:", err.message);
  });

  console.log("Navigating to http://localhost:5173/arena.html?env=foraging&flies=1...");
  await page.goto("http://localhost:5173/arena.html?env=foraging&flies=1");

  console.log("Waiting for .fly element in UI...");
  await page.waitForSelector(".fly", { timeout: 45000 });
  console.log("Fly element appeared! Clicking #play to start simulation...");

  await page.click("#play");

  console.log("Running simulation for 5 seconds to observe natural locomotion...");
  for (let sec = 1; sec <= 5; sec++) {
    await page.waitForTimeout(1000);
    const cardText = await page.$eval(".fly", el => el.innerText.replace(/\n/g, " | "));
    const fps = await page.$eval("#fps", el => el.textContent);
    const rt = await page.$eval("#rt", el => el.textContent);
    console.log(`[Running Sec ${sec}] FPS: ${fps} | SimSpeed: ${rt}x | Status: ${cardText}`);
  }

  console.log("\nSwitching vision source to 'touchplus_live'...");
  await page.selectOption("#visionSource", "touchplus_live");

  await page.waitForTimeout(2000);
  const visionStatus = await page.$eval("#visionStatus", el => el.textContent);
  console.log("Vision Status:", visionStatus);

  console.log("\nRunning simulation with Touch+ live camera for 5 seconds...");
  for (let sec = 1; sec <= 5; sec++) {
    await page.waitForTimeout(1000);
    const cardText = await page.$eval(".fly", el => el.innerText.replace(/\n/g, " | "));
    const fps = await page.$eval("#fps", el => el.textContent);
    const rt = await page.$eval("#rt", el => el.textContent);
    console.log(`[Camera Sec ${sec}] FPS: ${fps} | SimSpeed: ${rt}x | Status: ${cardText}`);
  }

  console.log("\nTriggering looming threat via #threat button...");
  await page.click("#threat");

  for (let sec = 1; sec <= 3; sec++) {
    await page.waitForTimeout(1000);
    const cardText = await page.$eval(".fly", el => el.innerText.replace(/\n/g, " | "));
    console.log(`[Post-Loom Sec ${sec}] Status: ${cardText}`);
  }

  await browser.close();
  console.log("\nTest completed successfully!");
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
