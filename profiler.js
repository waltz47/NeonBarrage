class Profiler {
  constructor() {
    this.metrics = {};
    this.currentFrame = 0;
    this.frameMetrics = {};
    this.FRAMES_TO_TRACK = 600; // Track 10 seconds worth of frames at 60fps
    this.sectionStack = []; // Track nested sections
    this.currentSection = null;
  }

  startProfile(section) {
    const now = performance.now();
    
    // Create section path based on stack
    const sectionPath = this.sectionStack.length > 0 
      ? `${this.sectionStack[this.sectionStack.length - 1]}/${section}`
      : section;
    
    if (!this.metrics[sectionPath]) {
      this.metrics[sectionPath] = {
        totalTime: 0,
        calls: 0,
        maxTime: 0,
        minTime: Infinity,
        avgTime: 0,
        lastFrameTime: 0,
        depth: this.sectionStack.length,
        children: new Set()
      };
    }

    // Update parent's children if we have a parent
    if (this.sectionStack.length > 0) {
      const parentPath = this.sectionStack[this.sectionStack.length - 1];
      this.metrics[parentPath].children.add(sectionPath);
    }

    this.metrics[sectionPath].startTime = now;
    this.sectionStack.push(sectionPath);
  }

  endProfile(section) {
    const now = performance.now();
    
    // Get the current section path from the stack
    const sectionPath = this.sectionStack[this.sectionStack.length - 1];
    
    // Validate we're ending the correct section
    if (!sectionPath || !sectionPath.endsWith(section)) {
      console.warn(`Profiler: Attempting to end section "${section}" but current section is "${sectionPath}"`);
      return;
    }

    const data = this.metrics[sectionPath];
    if (!data || !data.startTime) return;

    const duration = now - data.startTime;

    // Update metrics
    data.totalTime += duration;
    data.calls++;
    data.maxTime = Math.max(data.maxTime, duration);
    data.minTime = Math.min(data.minTime, duration);
    data.avgTime = data.totalTime / data.calls;
    data.lastFrameTime = duration;

    // Store frame-specific metrics
    if (!this.frameMetrics[this.currentFrame]) {
      this.frameMetrics[this.currentFrame] = {};
    }
    this.frameMetrics[this.currentFrame][sectionPath] = duration;

    // Pop the section from the stack
    this.sectionStack.pop();
  }

  nextFrame() {
    this.currentFrame = (this.currentFrame + 1) % this.FRAMES_TO_TRACK;
    
    // Check for unclosed sections from previous frame
    if (this.sectionStack.length > 0) {
      console.warn('Profiler: Unclosed sections from previous frame:', this.sectionStack);
      this.sectionStack = [];
    }
  }

  getMetrics() {
    const result = {};
    for (const [path, data] of Object.entries(this.metrics)) {
      result[path] = {
        avgTime: data.avgTime.toFixed(2),
        minTime: data.minTime.toFixed(2),
        maxTime: data.maxTime.toFixed(2),
        calls: data.calls,
        lastFrameTime: data.lastFrameTime.toFixed(2),
        msPerSecond: this.calculateMsPerSecond(path).toFixed(2),
        depth: data.depth,
        children: Array.from(data.children)
      };
    }
    return result;
  }

  calculateMsPerSecond(path) {
    let totalMs = 0;
    let frames = 0;
    for (let i = 0; i < this.FRAMES_TO_TRACK; i++) {
      if (this.frameMetrics[i] && this.frameMetrics[i][path]) {
        totalMs += this.frameMetrics[i][path];
        frames++;
      }
    }
    return frames > 0 ? (totalMs * (60 / frames)) : 0;
  }

  reset() {
    this.metrics = {};
    this.frameMetrics = {};
    this.currentFrame = 0;
    this.sectionStack = [];
  }

  // Format metrics for console output with hierarchical view
  formatMetrics() {
    const metrics = this.getMetrics();
    let output = "\n=== PERFORMANCE METRICS ===\n";
    
    // Get root sections (those without '/')
    const rootSections = Object.keys(metrics).filter(path => !path.includes('/'));
    
    // Sort root sections by ms per second (highest first)
    rootSections.sort((a, b) => parseFloat(metrics[b].msPerSecond) - parseFloat(metrics[a].msPerSecond));
    
    // Process each root section and its children
    for (const section of rootSections) {
      const data = metrics[section];
      output += `\n${section}:\n`;
      output += `  CPU Load: ${data.msPerSecond}ms/sec\n`;
      output += `  Avg: ${data.avgTime}ms\n`;
      output += `  Min: ${data.minTime}ms\n`;
      output += `  Max: ${data.maxTime}ms\n`;
      output += `  Calls: ${data.calls}\n`;
      
      // Sort and process children
      if (data.children && data.children.size > 0) {
        output += "  Subsections:\n";
        const children = [...data.children].sort((a, b) => 
          parseFloat(metrics[b].msPerSecond) - parseFloat(metrics[a].msPerSecond)
        );
        
        for (const child of children) {
          output += this.formatSection(child, metrics, 2);
        }
      }
    }
    
    return output;
  }

  formatSection(sectionPath, metrics, depth) {
    const data = metrics[sectionPath];
    const indent = '  '.repeat(depth);
    
    // Extract just the section name from the full path
    const sectionName = sectionPath.split('/').pop();
    
    let output = `\n${indent}${sectionName}:\n`;
    output += `${indent}  CPU Load: ${data.msPerSecond}ms/sec\n`;
    output += `${indent}  Avg: ${data.avgTime}ms\n`;
    output += `${indent}  Min: ${data.minTime}ms\n`;
    output += `${indent}  Max: ${data.maxTime}ms\n`;
    output += `${indent}  Calls: ${data.calls}\n`;
    
    // Sort children by ms per second and ensure they're displayed
    if (data.children && data.children.size > 0) {
      const children = [...data.children].sort((a, b) => 
        parseFloat(metrics[b].msPerSecond) - parseFloat(metrics[a].msPerSecond)
      );
      
      output += `${indent}  Subsections:\n`;
      for (const child of children) {
        output += this.formatSection(child, metrics, depth + 1);
      }
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