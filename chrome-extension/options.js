// Dev3000 Extension Options Page Script

class Dev3000Options {
  constructor() {
    this.defaultSettings = {
      autoAttach: true,
      customPorts: [3000, 3001, 4200, 5173, 8080],
      customHosts: ["localhost", "127.0.0.1"],
      monitorAllLocalhost: true,
      captureConsole: true,
      captureNetwork: true,
      captureErrors: true,
      capturePerformance: true,
      maxLogEntries: 1000
    }

    this.initialize()
  }

  async initialize() {
    await this.loadSettings()
    this.setupEventListeners()
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get("dev3000Settings")
      const settings = { ...this.defaultSettings, ...result.dev3000Settings }

      this.populateForm(settings)
    } catch (error) {
      console.error("Failed to load settings:", error)
      this.populateForm(this.defaultSettings)
    }
  }

  populateForm(settings) {
    // Checkboxes
    document.getElementById("autoAttach").checked = settings.autoAttach
    document.getElementById("monitorAllLocalhost").checked = settings.monitorAllLocalhost
    document.getElementById("captureConsole").checked = settings.captureConsole
    document.getElementById("captureNetwork").checked = settings.captureNetwork
    document.getElementById("captureErrors").checked = settings.captureErrors
    document.getElementById("capturePerformance").checked = settings.capturePerformance

    // Text inputs
    document.getElementById("customPorts").value = settings.customPorts.join(", ")
    document.getElementById("customHosts").value = settings.customHosts.join(", ")
    document.getElementById("maxLogEntries").value = settings.maxLogEntries

    // Update preset port selection
    this.updatePresetPorts(settings.customPorts)
  }

  updatePresetPorts(selectedPorts) {
    const portTags = document.querySelectorAll(".port-tag")
    portTags.forEach((tag) => {
      const port = parseInt(tag.dataset.port, 10)
      if (selectedPorts.includes(port)) {
        tag.classList.add("selected")
      } else {
        tag.classList.remove("selected")
      }
    })
  }

  setupEventListeners() {
    // Save button
    document.getElementById("saveBtn").addEventListener("click", () => {
      this.saveSettings()
    })

    // Reset button
    document.getElementById("resetBtn").addEventListener("click", () => {
      this.resetSettings()
    })

    // Preset port tags
    document.querySelectorAll(".port-tag").forEach((tag) => {
      tag.addEventListener("click", () => {
        this.togglePresetPort(tag)
      })
    })

    // Custom ports input - update preset selection on change
    document.getElementById("customPorts").addEventListener("input", () => {
      const ports = this.parsePortsInput()
      this.updatePresetPorts(ports)
    })
  }

  togglePresetPort(tag) {
    const port = parseInt(tag.dataset.port, 10)
    const currentPorts = this.parsePortsInput()

    if (currentPorts.includes(port)) {
      // Remove port
      const newPorts = currentPorts.filter((p) => p !== port)
      document.getElementById("customPorts").value = newPorts.join(", ")
      tag.classList.remove("selected")
    } else {
      // Add port
      currentPorts.push(port)
      currentPorts.sort((a, b) => a - b)
      document.getElementById("customPorts").value = currentPorts.join(", ")
      tag.classList.add("selected")
    }
  }

  parsePortsInput() {
    const input = document.getElementById("customPorts").value
    return input
      .split(",")
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => !Number.isNaN(p) && p > 0 && p < 65536)
      .filter((p, i, arr) => arr.indexOf(p) === i) // Remove duplicates
      .sort((a, b) => a - b)
  }

  parseHostsInput() {
    const input = document.getElementById("customHosts").value
    return input
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .filter((h, i, arr) => arr.indexOf(h) === i) // Remove duplicates
  }

  async saveSettings() {
    try {
      const settings = {
        autoAttach: document.getElementById("autoAttach").checked,
        customPorts: this.parsePortsInput(),
        customHosts: this.parseHostsInput(),
        monitorAllLocalhost: document.getElementById("monitorAllLocalhost").checked,
        captureConsole: document.getElementById("captureConsole").checked,
        captureNetwork: document.getElementById("captureNetwork").checked,
        captureErrors: document.getElementById("captureErrors").checked,
        capturePerformance: document.getElementById("capturePerformance").checked,
        maxLogEntries: parseInt(document.getElementById("maxLogEntries").value, 10) || 1000
      }

      await chrome.storage.sync.set({ dev3000Settings: settings })

      // Notify background script of settings change
      chrome.runtime.sendMessage({
        action: "settingsChanged",
        settings
      })

      this.showStatus("Settings saved successfully!", "success")
    } catch (error) {
      console.error("Failed to save settings:", error)
      this.showStatus("Failed to save settings. Please try again.", "error")
    }
  }

  async resetSettings() {
    try {
      await chrome.storage.sync.remove("dev3000Settings")

      this.populateForm(this.defaultSettings)

      // Notify background script
      chrome.runtime.sendMessage({
        action: "settingsChanged",
        settings: this.defaultSettings
      })

      this.showStatus("Settings reset to defaults", "success")
    } catch (error) {
      console.error("Failed to reset settings:", error)
      this.showStatus("Failed to reset settings. Please try again.", "error")
    }
  }

  showStatus(message, type) {
    const statusEl = document.getElementById("statusMessage")
    statusEl.textContent = message
    statusEl.className = `status-message ${type}`
    statusEl.style.display = "block"

    // Hide after 3 seconds
    setTimeout(() => {
      statusEl.style.display = "none"
    }, 3000)
  }
}

// Initialize options page when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new Dev3000Options()
})
