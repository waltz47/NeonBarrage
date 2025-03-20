class Profiler {
  constructor() {
    this.metrics = {};
    this.currentFrame = 0;
    this.frameMetrics = {};
    this.FRAMES_TO_TRACK = 60; // Track 1 second worth of frames at 60fps
  }

  startProfile(name) {
    if (!this.metrics[name]) {
      this.metrics[name] = {
        totalTime: 0,
        calls: 0,
        maxTime: 0,
        minTime: Infinity,
        avgTime: 0,
        lastFrameTime: 0
      };
    }
    this.metrics[name].startTime = performance.now();
  }

  endProfile(name) {
    if (!this.metrics[name] || !this.metrics[name].startTime) return;

    const endTime = performance.now();
    const duration = endTime - this.metrics[name].startTime;

    // Update metrics
    this.metrics[name].totalTime += duration;
    this.metrics[name].calls++;
    this.metrics[name].maxTime = Math.max(this.metrics[name].maxTime, duration);
    this.metrics[name].minTime = Math.min(this.metrics[name].minTime, duration);
    this.metrics[name].avgTime = this.metrics[name].totalTime / this.metrics[name].calls;
    this.metrics[name].lastFrameTime = duration;

    // Store frame-specific metrics
    if (!this.frameMetrics[this.currentFrame]) {
      this.frameMetrics[this.currentFrame] = {};
    }
    this.frameMetrics[this.currentFrame][name] = duration;
  }

  nextFrame() {
    this.currentFrame = (this.currentFrame + 1) % this.FRAMES_TO_TRACK;
  }

  getMetrics() {
    const result = {};
    for (const [name, data] of Object.entries(this.metrics)) {
      result[name] = {
        avgTime: data.avgTime.toFixed(2),
        minTime: data.minTime.toFixed(2),
        maxTime: data.maxTime.toFixed(2),
        calls: data.calls,
        lastFrameTime: data.lastFrameTime.toFixed(2),
        msPerSecond: this.calculateMsPerSecond(name).toFixed(2)
      };
    }
    return result;
  }

  calculateMsPerSecond(name) {
    let totalMs = 0;
    let frames = 0;
    for (let i = 0; i < this.FRAMES_TO_TRACK; i++) {
      if (this.frameMetrics[i] && this.frameMetrics[i][name]) {
        totalMs += this.frameMetrics[i][name];
        frames++;
      }
    }
    return frames > 0 ? (totalMs * (60 / frames)) : 0;
  }

  reset() {
    this.metrics = {};
    this.frameMetrics = {};
    this.currentFrame = 0;
  }

  // Format metrics for console output
  formatMetrics() {
    const metrics = this.getMetrics();
    let output = "\n=== PERFORMANCE METRICS ===\n";
    
    // Sort by ms per second (highest first)
    const sortedMetrics = Object.entries(metrics).sort((a, b) => 
      parseFloat(b[1].msPerSecond) - parseFloat(a[1].msPerSecond)
    );

    for (const [name, data] of sortedMetrics) {
      output += `\n${name}:\n`;
      output += `  CPU Load: ${data.msPerSecond}ms/sec\n`;
      output += `  Avg: ${data.avgTime}ms\n`;
      output += `  Min: ${data.minTime}ms\n`;
      output += `  Max: ${data.maxTime}ms\n`;
      output += `  Calls: ${data.calls}\n`;
    }
    
    return output;
  }
}

// Create a global instance
const profiler = new Profiler();

// Export both the class and the global instance
module.exports = {
  Profiler,
  profiler
}; 