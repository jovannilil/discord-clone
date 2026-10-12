// Looks at a few frames of a camera stream and says whether it shows a real picture,
// or the solid green / black frames that DroidCam and other virtual cameras send when
// they can't deliver video in the format that was asked for (or aren't streaming at all).

const SIZE_W = 32;
const SIZE_H = 24;

function classify(pixels) {
  let green = 0;
  let black = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (g > 80 && r < 70 && b < 70 && g - r > 50) green++;
    if (r < 18 && g < 18 && b < 18) black++;
  }
  if (green / n > 0.85) return "green";
  if (black / n > 0.97) return "black";
  return "ok";
}

/** Resolves to "ok", "green" or "black". Keeps looking until it sees a real frame or time runs out. */
export async function checkPicture(stream, timeoutMs = 3000) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = SIZE_W;
  canvas.height = SIZE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let result = "black"; // no frames at all counts as black
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (video.readyState < 2 || !video.videoWidth) continue;
    ctx.drawImage(video, 0, 0, SIZE_W, SIZE_H);
    result = classify(ctx.getImageData(0, 0, SIZE_W, SIZE_H).data);
    if (result === "ok") break; // cameras can start black for a moment, so keep looking until timeout
  }
  video.pause();
  video.srcObject = null;
  return result;
}
