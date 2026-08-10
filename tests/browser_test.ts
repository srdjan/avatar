import { assertEquals } from "jsr:@std/assert@1.0.14";
import { AVATAR_ASSETS } from "@srdjan/avatar/assets";
import { renderFacialRig } from "@srdjan/avatar/server";
import { chromium } from "npm:playwright@1.60.0";

function localPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

Deno.test("SSR rig IDs cannot create browser event attributes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const hostileId = 'east" onpointerenter="globalThis.pwned=1';
    const svg = '<svg data-stub="safe" />';
    const html = renderFacialRig({
      id: hostileId,
      label: "East",
      reaction: null,
      precedingReaction: null,
      microReaction: null,
      personality: { amplitudeScale: 1, durationScale: 1, audioProbability: 0 },
      rigKind: "bot",
      baseSvg: svg,
      expressionSvg: svg,
      microSvg: svg,
    });
    await page.setContent(html);
    await page.locator(".avatar-rig").hover();

    assertEquals(await page.locator("[onpointerenter]").count(), 0);
    assertEquals(await page.locator(".avatar-rig").getAttribute("id"), `avatar-rig-${hostileId}`);
    assertEquals(
      await page.evaluate(() => (globalThis as typeof globalThis & { pwned?: number }).pwned ?? 0),
      0,
    );
  } finally {
    await browser.close();
  }
});

Deno.test("browser runtime animates an AI turn rig without consumer coupling", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="seat is-turn is-ai">
        <span id="avatar-rig-east" class="avatar-rig" data-rig-kind="bot"
          data-seat-audio-probability="0"
          data-reaction-kind="" data-reaction-expression="" data-reaction-intensity="0"
          data-reaction-motion="" data-reaction-duration-ms="0" data-reaction-confidence="1"
          data-reaction-voice-cue="" data-reaction-id="0"
          data-preceding-kind="" data-preceding-expression="" data-preceding-intensity="0"
          data-preceding-motion="" data-preceding-duration-ms="0" data-preceding-confidence="1"
          data-preceding-voice-cue="" data-preceding-id="0"
          data-micro-kind="" data-micro-expression="" data-micro-intensity="0"
          data-micro-motion="" data-micro-duration-ms="0" data-micro-confidence="1"
          data-micro-voice-cue="" data-micro-id="0">
          <svg class="avatar-base"><g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g></svg>
          <svg class="avatar-expression"><g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g></svg>
        </span>
      </div>
    `);
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
    await page.evaluate(() => {
      const api = (window as unknown as { FacialRig: { init(): void; sync(): void } }).FacialRig;
      api.init();
      api.sync();
    });
    await page.waitForTimeout(250);
    const idleScale = await page.locator("#avatar-rig-east").evaluate((element) =>
      (element as HTMLElement).style.getPropertyValue("--rig-breath-scale")
    );
    assertEquals(idleScale.length > 0, true);

    await page.locator("#avatar-rig-east").evaluate((element) => {
      element.setAttribute("data-reaction-kind", "TestReaction");
      element.setAttribute("data-reaction-expression", "happiness");
      element.setAttribute("data-reaction-intensity", "1");
      element.setAttribute("data-reaction-motion", "pop");
      element.setAttribute("data-reaction-duration-ms", "300");
      element.setAttribute("data-reaction-id", "1");
    });
    await page.evaluate(() => {
      (window as unknown as { FacialRig: { sync(): void } }).FacialRig.sync();
    });
    assertEquals(
      await page.locator("#avatar-rig-east").evaluate((element) =>
        element.classList.contains("is-reacting")
      ),
      true,
    );
  } finally {
    await browser.close();
  }
});

Deno.test("standalone CSS preserves consumer tokens and supplies defaults", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>.avatar-rig.probe { color: var(--avatar-primary-fixed); }</style>
      <span id="fallback" class="avatar-rig probe"></span>
      <span id="consumer" class="avatar-rig probe" style="--primary-fixed: #010203"></span>
      <span id="override" class="avatar-rig probe" style="--avatar-primary-fixed: #040506"></span>
    `);
    await page.addStyleTag({ path: localPath(AVATAR_ASSETS.facialRigStyles.url) });
    const colors = await page.locator(".probe").evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).color)
    );
    assertEquals(colors, ["rgb(245, 224, 189)", "rgb(1, 2, 3)", "rgb(4, 5, 6)"]);
  } finally {
    await browser.close();
  }
});

Deno.test("iPhone idle mode performs no style-attribute churn", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await page.setContent(`
      <span id="avatar-rig-ios" class="avatar-rig" data-rig-kind="bot"
        data-seat-audio-probability="0"
        data-reaction-kind="" data-reaction-expression="" data-reaction-intensity="0"
        data-reaction-motion="" data-reaction-duration-ms="0" data-reaction-confidence="1"
        data-reaction-voice-cue="" data-reaction-id="0"
        data-preceding-kind="" data-preceding-expression="" data-preceding-intensity="0"
        data-preceding-motion="" data-preceding-duration-ms="0" data-preceding-confidence="1"
        data-preceding-voice-cue="" data-preceding-id="0"
        data-micro-kind="" data-micro-expression="" data-micro-intensity="0"
        data-micro-motion="" data-micro-duration-ms="0" data-micro-confidence="1"
        data-micro-voice-cue="" data-micro-id="0">
        <svg class="avatar-base">
          <g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g>
        </svg>
        <svg class="avatar-expression">
          <g class="face-eyes"></g><g class="face-mouth"></g><g class="face-brows"></g>
        </svg>
      </span>
    `);
    await page.addScriptTag({ path: localPath(AVATAR_ASSETS.facialRigScript.url) });
    const mutationCount = await page.evaluate(async () => {
      const api = (window as unknown as { FacialRig: { init(): void; sync(): void } }).FacialRig;
      api.init();
      api.sync();
      await new Promise(requestAnimationFrame);

      const rig = document.querySelector("#avatar-rig-ios")!;
      let count = 0;
      const observer = new MutationObserver((records) => {
        count += records.filter((record) => record.attributeName === "style").length;
      });
      observer.observe(rig, { attributes: true, attributeFilter: ["style"], subtree: true });
      await new Promise((resolve) => setTimeout(resolve, 400));
      observer.disconnect();
      return count;
    });
    assertEquals(mutationCount, 0);
  } finally {
    await browser.close();
  }
});

Deno.test("computed style oracle pins motion, crossfade, and reduced-motion behavior", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`
      <span id="rig" class="avatar-rig is-reacting motion-pop" data-rig-kind="bot"
        data-reaction-expression="happiness">
        <svg class="avatar avatar-base"><g class="face-eyes-plane"></g></svg>
        <svg class="avatar avatar-expression"></svg>
        <svg class="avatar avatar-micro-expression"></svg>
      </span>
    `);
    await page.addStyleTag({ path: localPath(AVATAR_ASSETS.facialRigStyles.url) });
    const active = await page.locator("#rig").evaluate((rig) => {
      const style = getComputedStyle(rig);
      const base = getComputedStyle(rig.querySelector(".avatar-base")!);
      const expression = getComputedStyle(rig.querySelector(".avatar-expression")!);
      return {
        display: style.display,
        position: style.position,
        animationName: style.animationName,
        baseOpacity: base.opacity,
        expressionOpacity: expression.opacity,
      };
    });
    assertEquals(active, {
      display: "inline-grid",
      position: "relative",
      animationName: "bot-avatar-react-pop",
      baseOpacity: "0",
      expressionOpacity: "1",
    });

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await page.locator("#rig").evaluate((rig) => ({
      animationName: getComputedStyle(rig).animationName,
      planeTransform: getComputedStyle(rig.querySelector(".face-eyes-plane")!).transform,
      expressionAnimationName: getComputedStyle(
        rig.querySelector(".avatar-expression")!,
      ).animationName,
    }));
    assertEquals(reduced, {
      animationName: "none",
      planeTransform: "none",
      expressionAnimationName: "none",
    });
  } finally {
    await browser.close();
  }
});
