// Runs on the audio thread. Collects microphone samples in blocks of 2048 and posts them to the page
// together with the block's loudness (RMS and peak) for the level meter.
//
// The page loads this file with audioWorklet.addModule() (src/ml/audio/capture.ts). It does nothing else than copy
// samples, so it stays fast and never drops audio even when the page is busy running the model.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(2048)
    this.filled = 0
  }

  process(inputs, outputs) {
    const channel = inputs[0] && inputs[0][0]
    // With no signal connected (the microphone is muted or has ended) the input is empty. Count that as silence, so the
    // recording keeps its true length and the page can see that nothing is coming in.
    const quantum = outputs[0] && outputs[0][0] ? outputs[0][0].length : 128
    const length = channel ? channel.length : quantum
    for (let i = 0; i < length; i++) {
      this.buffer[this.filled++] = channel ? channel[i] : 0
      if (this.filled === this.buffer.length) this.flush()
    }
    return true
  }

  flush() {
    let sum = 0
    let peak = 0
    for (let i = 0; i < this.filled; i++) {
      const v = this.buffer[i]
      sum += v * v
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
    const samples = this.buffer.slice(0, this.filled)
    this.port.postMessage({ samples, rms: Math.sqrt(sum / this.filled), peak }, [samples.buffer])
    this.filled = 0
  }
}

registerProcessor('capture-processor', CaptureProcessor)
