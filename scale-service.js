/**
 * POSTRACHANG - Scale Service (Web Serial API & Driver for T-BOSS TBS-CW)
 * Hardware: T-BOSS TBS-CW (30 kg) with WCH CH340 USB-RS232 Adapter
 * Protocol: 9600 bps, 8-N-1, Continuous ASCII stream:
 * Examples: "ST,GS,+  0.000kg\r\n", "US,GS,+  1.250kg\r\n", "ST,NT,+  0.520kg\r\n"
 */

class ScaleService {
  constructor() {
    this.port = null;
    this.reader = null;
    this.readableStreamClosed = null;
    this.keepReading = false;
    this.baudRate = 9600;
    this.ws = null;
    this.wsUrl = 'ws://127.0.0.1:8080';

    // Scale State
    this.weight = 0.000;
    this.rawWeight = 0.000;
    this.tareOffset = 0.000;
    this.zeroOffset = 0.000;
    this.isStable = false;
    this.isNet = false;
    this.isConnected = false;
    this.isSimulated = false;

    // Simulation Timer
    this.simInterval = null;

    // Event Listeners
    this.listeners = {
      data: [],
      status: []
    };
  }

  // Subscribe to weight events
  onData(callback) {
    this.listeners.data.push(callback);
  }

  // Subscribe to status/connection events
  onStatus(callback) {
    this.listeners.status.push(callback);
  }

  emitData(payload) {
    this.listeners.data.forEach(cb => {
      try { cb(payload); } catch (e) { console.error('Scale data listener err:', e); }
    });
  }

  emitStatus(payload) {
    this.listeners.status.forEach(cb => {
      try { cb(payload); } catch (e) { console.error('Scale status listener err:', e); }
    });
  }

  // Platform Detection (Detect Android OS or Android POS environment)
  isAndroidPlatform() {
    return /Android/i.test(navigator.userAgent) || 
           (navigator.userAgentData && navigator.userAgentData.platform === 'Android');
  }

  // Check if Web Serial API is supported in browser (Desktop PC only)
  isSupported() {
    return ('serial' in navigator) && !this.isAndroidPlatform();
  }

  // Connect via WebUSB for WCH CH340 (Vendor ID: 0x1A86) on Android Chrome
  async connectWebUsbCh340() {
    if (!('usb' in navigator)) {
      throw new Error('เบราว์เซอร์ไม่รองรับ WebUSB API');
    }
    try {
      this.usbDevice = await navigator.usb.requestDevice({
        filters: [
          { vendorId: 0x1a86 }, // WCH CH340 USB-RS232 Adapter
          { vendorId: 0x0403 }, // FTDI
          { vendorId: 0x067b }, // Prolific PL2303
          { vendorId: 0x10c4 }  // Silicon Labs CP210x
        ]
      });
      await this.usbDevice.open();
      if (this.usbDevice.configuration === null) {
        await this.usbDevice.selectConfiguration(1);
      }
      await this.usbDevice.claimInterface(0);

      this.isConnected = true;
      this.isSimulated = false;
      this.emitStatus({
        connected: true,
        simulated: false,
        message: 'เชื่อมต่อตราชั่งผ่าน WebUSB (CH340: 0x1A86) สำเร็จ'
      });

      this.keepReading = true;
      this.readWebUsbLoop();
      return true;
    } catch (usbErr) {
      console.warn('WebUSB CH340 connect error:', usbErr);
      throw usbErr;
    }
  }

  async readWebUsbLoop() {
    if (!this.usbDevice) return;
    try {
      let epIn = 2; // Default Bulk IN endpoint for CH340
      for (const iface of (this.usbDevice.configuration ? this.usbDevice.configuration.interfaces : [])) {
        for (const alt of iface.alternates) {
          for (const ep of alt.endpoints) {
            if (ep.direction === 'in') {
              epIn = ep.endpointNumber;
              break;
            }
          }
        }
      }

      let textDecoder = new TextDecoder();
      let buffer = '';
      while (this.keepReading && this.isConnected) {
        const result = await this.usbDevice.transferIn(epIn, 64);
        if (result && result.data && result.data.byteLength > 0) {
          buffer += textDecoder.decode(result.data);
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop();
          for (const line of lines) {
            if (line.trim()) this.parseLine(line.trim());
          }
        }
      }
    } catch (e) {
      console.warn('WebUSB transferIn read loop exit:', e);
    }
  }

  // Connect via Web Serial API (PC), WebUSB (CH340), or WebSocket Bridge (Android POS)
  async connect(preferWebSocket = false) {
    const isAndroid = this.isAndroidPlatform();

    if (isAndroid) {
      this.isConnected = true;
      this.startSimulation();
      this.emitStatus({
        connected: true,
        simulated: true,
        isAndroid: true,
        message: 'ตราชั่ง: โหมดสัมผัส 14"'
      });
      return true;
    }

    // 1. Try Native Web Serial (Supported strictly on Desktop PC Chrome / Edge)
    if (this.isSupported() && !preferWebSocket) {
      try {
        this.port = await navigator.serial.requestPort();
        await this.port.open({
          baudRate: this.baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none'
        });

        this.isConnected = true;
        this.isSimulated = false;
        this.emitStatus({ connected: true, simulated: false, message: 'เชื่อมต่อตราชั่ง T-BOSS สำเร็จ (พอร์ต Serial)' });

        this.keepReading = true;
        this.readLoop();
        return true;
      } catch (err) {
        console.warn('Web Serial open error:', err);
      }
    }

    // 2. Try WebSocket Bridge (Optional for Android POS with OTG Serial2WebSocket app)
    try {
      await this.connectWebSocket(this.wsUrl);
      return true;
    } catch (wsErr) {
      console.warn('WebSocket bridge unavailable:', wsErr);
    }

    // 3. Fallback: Smoothly activate Manual Touch Weight Input (Zero error alert on Android)
    this.isConnected = true;
    this.startSimulation();
    this.emitStatus({
      connected: true,
      simulated: true,
      isAndroid: false,
      message: 'เปิดใช้งานโหมดป้อนน้ำหนักสัมผัสหน้าจอ (Manual / Quick Weight)'
    });

    if (!isAndroid) {
      if (typeof showNotification === 'function') {
        showNotification('ℹ️ ไม่พบการเชื่อมต่อ Serial ระบบเปิดโหมดป้อนสัมผัสหน้าจอให้อัตโนมัติ', 'info');
      }
    }
    return true;
  }

  // Connect via WebSocket Bridge (for Android POS / OTG Serial to WebSocket)
  connectWebSocket(url = 'ws://127.0.0.1:8080') {
    return new Promise((resolve, reject) => {
      this.wsUrl = url;
      if (this.ws) {
        try { this.ws.close(); } catch(e) {}
        this.ws = null;
      }

      let opened = false;
      try {
        const socket = new WebSocket(url);
        this.ws = socket;

        const timeout = setTimeout(() => {
          if (!opened && socket.readyState !== WebSocket.OPEN) {
            try { socket.close(); } catch(e) {}
            reject(new Error('เชื่อมต่อ WebSocket ที่ ' + url + ' หมดเวลา'));
          }
        }, 3000);

        socket.onopen = () => {
          opened = true;
          clearTimeout(timeout);
          this.isConnected = true;
          this.isSimulated = false;
          this.emitStatus({
            connected: true,
            simulated: false,
            message: 'เชื่อมต่อตราชั่ง T-BOSS สำเร็จ (ผ่าน WebSocket: ' + url + ')'
          });
          resolve(true);
        };

        socket.onmessage = (event) => {
          const text = event.data;
          if (typeof text === 'string') {
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
              if (line.trim()) this.parseLine(line.trim());
            }
          }
        };

        socket.onerror = (err) => {
          clearTimeout(timeout);
          if (!opened) {
            reject(new Error('ไม่สามารถเชื่อมต่อไปยัง ' + url + ' ได้'));
          }
        };

        socket.onclose = () => {
          if (this.isConnected) {
            this.isConnected = false;
            this.emitStatus({ connected: false, simulated: false, message: 'การเชื่อมต่อตราชั่ง (WebSocket) ปิดลงแล้ว' });
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  // Continuous Read Loop
  async readLoop() {
    let buffer = '';
    const textDecoder = new TextDecoderStream();
    this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    try {
      while (this.keepReading) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split(/\r?\n/);
          // Keep the last partial chunk in buffer
          buffer = lines.pop();

          for (const line of lines) {
            this.parseLine(line.trim());
          }
        }
      }
    } catch (err) {
      console.warn('Scale stream read error:', err);
    } finally {
      this.reader.releaseLock();
    }
  }

  // Parse T-BOSS TBS-CW ASCII Protocol
  // Formats:
  // "ST,GS,+  0.000kg"
  // "US,GS,+  1.250kg"
  // "ST,NT,+  0.450kg"
  // "ST,GS,   0.00kg"
  parseLine(raw) {
    if (!raw || raw.length < 5) return;

    // Pattern: (ST|US),(GS|NT),([+-]?\s*\d+\.?\d*)\s*(kg|g)?
    const match = raw.match(/(ST|US)\s*,\s*(GS|NT)\s*,\s*([+-]?\s*[\d\.]+)\s*(kg|g)?/i);
    if (match) {
      const stabilityStr = match[1].toUpperCase();
      const modeStr = match[2].toUpperCase();
      const weightNum = parseFloat(match[3].replace(/\s+/g, ''));
      const unit = (match[4] || 'kg').toLowerCase();

      // Convert gram to kg if scale outputs in grams
      let normalizedWeight = isNaN(weightNum) ? 0 : weightNum;
      if (unit === 'g') {
        normalizedWeight = normalizedWeight / 1000.0;
      }

      this.rawWeight = normalizedWeight;
      this.isStable = (stabilityStr === 'ST');
      this.isNet = (modeStr === 'NT');

      // Apply software offsets (allow actual signed weight including negative values to sync with physical display)
      const effectiveWeight = parseFloat((this.rawWeight - this.tareOffset - this.zeroOffset).toFixed(3));
      this.weight = effectiveWeight;

      this.emitData({
        weight: this.weight,
        rawWeight: this.rawWeight,
        isStable: this.isStable,
        isNet: this.isNet || this.tareOffset > 0,
        raw: raw,
        unit: 'kg'
      });
    }
  }

  // Set Tare (หักภาชนะ)
  tare() {
    this.tareOffset = this.rawWeight;
    this.weight = 0.000;
    this.isNet = true;
    this.emitData({
      weight: 0.000,
      rawWeight: this.rawWeight,
      isStable: this.isStable,
      isNet: true,
      raw: 'TARE_APPLIED',
      unit: 'kg'
    });
  }

  // Set Zero (เซ็ตศูนย์)
  zero() {
    this.zeroOffset = this.rawWeight;
    this.tareOffset = 0.000;
    this.weight = 0.000;
    this.isNet = false;
    this.emitData({
      weight: 0.000,
      rawWeight: this.rawWeight,
      isStable: true,
      isNet: false,
      raw: 'ZERO_APPLIED',
      unit: 'kg'
    });
  }

  // Reset Tare & Zero
  clearTare() {
    this.tareOffset = 0.000;
    this.zeroOffset = 0.000;
    this.isNet = false;
    this.weight = parseFloat(this.rawWeight.toFixed(3));
    this.emitData({
      weight: this.weight,
      rawWeight: this.rawWeight,
      isStable: this.isStable,
      isNet: false,
      raw: 'TARE_CLEARED',
      unit: 'kg'
    });
  }

  // Disconnect Hardware Port
  async disconnect() {
    this.keepReading = false;
    if (this.reader) {
      await this.reader.cancel();
      await this.readableStreamClosed.catch(() => {});
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.isConnected = false;
    this.emitStatus({ connected: false, simulated: false, message: 'ยกเลิกการเชื่อมต่อตราชั่งแล้ว' });
  }

  // Simulation Mode for testing without physical scale
  startSimulation() {
    this.stopSimulation();
    this.isSimulated = true;
    this.isConnected = true;
    this.rawWeight = 0.000;
    this.weight = 0.000;
    this.isStable = true;

    this.emitStatus({
      connected: true,
      simulated: true,
      message: 'เปิดโหมดจำลองตราชั่ง T-BOSS (Simulation Mode)'
    });

    this.emitData({
      weight: this.weight,
      rawWeight: this.rawWeight,
      isStable: true,
      isNet: false,
      raw: 'SIM_START',
      unit: 'kg'
    });
  }

  setSimulatedWeight(targetKg, makeStable = true) {
    if (!this.isSimulated) {
      this.startSimulation();
    }
    this.rawWeight = parseFloat(targetKg) || 0.000;
    this.isStable = makeStable;
    const effective = parseFloat((this.rawWeight - this.tareOffset - this.zeroOffset).toFixed(3));
    this.weight = effective;

    this.emitData({
      weight: this.weight,
      rawWeight: this.rawWeight,
      isStable: this.isStable,
      isNet: this.tareOffset > 0,
      raw: `SIM_SET,${effective.toFixed(3)}kg`,
      unit: 'kg'
    });
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    if (this.isSimulated) {
      this.isSimulated = false;
      this.isConnected = false;
      this.emitStatus({ connected: false, simulated: false, message: 'ปิดโหมดจำลองตราชั่งแล้ว' });
    }
  }
}

// Global Singleton Instance
window.scaleService = new ScaleService();
