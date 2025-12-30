import { WebUSB } from 'usb';
import { app, Tray, Menu, nativeImage } from 'electron';
import electronSquirrelStartup from 'electron-squirrel-startup';
import path from 'path';

if (electronSquirrelStartup) app.quit();

const rootPath = app.getAppPath();
let tray;
let chargeState = false;
let chargeMonitorInterval;
let deviceLock = false; // Mutex to prevent concurrent device access

app.whenReady().then(() => {
    const icon = nativeImage.createFromPath(path.join(rootPath, 'src/assets/battery_0.ico'));
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Quit', type: 'normal', click: quitClick }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip('Searching for device');
    tray.setTitle('Razer battery life');

    tray.on("double-click", () => {
        refreshDeviceStatus();
    });

    // Start monitoring (handles both battery and charge state)
    monitorChargeState();
    
    // Initial refresh
    refreshDeviceStatus();
});

async function refreshDeviceStatus() {
    const status = await getDeviceStatus();
    if (status) {
        chargeState = status.isCharging;
        const assetPath = getBatteryIconPath(status.batteryLevel, status.isCharging);
        tray.setImage(nativeImage.createFromPath(path.join(rootPath, assetPath)));
        tray.setToolTip(`${status.batteryLevel}%${status.isCharging ? ' (Charging)' : ''}`);
    }
}

async function setTrayDetails(tray, isCharging) {
    const battLife = await getBattery();
    if (battLife === 0 || battLife === undefined) return;

    const assetPath = getBatteryIconPath(battLife, isCharging);

    tray.setImage(nativeImage.createFromPath(path.join(rootPath, assetPath)));
    tray.setToolTip(battLife === 0 ? "Device disconnected" : `${battLife}%`);
}

function getBatteryIconPath(val, isCharging) {
    const iconName = Math.floor(val / 10) * 10;
    return isCharging ? `src/assets/battery_100.ico` : `src/assets/battery_${iconName}.ico`;
}

function quitClick() {
    clearInterval(chargeMonitorInterval);
    if (process.platform !== 'darwin') app.quit();
}

// mouse stuff
const RazerVendorId = 0x1532;
const RazerProducts = {
    0x00A4: {
        name: 'Razer Mouse Dock Pro',
        transactionId: 0x1f
    },
    0x00AA: {
        name: 'Razer Basilisk V3 Pro Wired',
        transactionId: 0x1f
    },
    0x00AB: {
        name: 'Razer Basilisk V3 Pro Wireless',
        transactionId: 0x1f
    },
    0x00B9: {
        name: 'Razer Basilisk V3 X HyperSpeed',
        transactionId: 0x1f
    },
    0x007C: {
        name: "Razer DeathAdder V2 Pro Wired",
        transactionId: 0x3f
    },
    0x007D: {
        name: "Razer DeathAdder V2 Pro Wireless",
        transactionId: 0x3f
    },
    0x009C: {
        name: "Razer DeathAdder V2 X HyperSpeed",
        transactionId: 0x1f
    },
    0x00B3: {
        name: 'Razer Hyperpolling Wireless Dongle',
        transactionId: 0x1f
    },
    0x00B6: {
        name: 'Razer Deathadder V3 Pro Wired',
        transactionId: 0x1f
    },
    0x00B7: {
        name: 'Razer Deathadder V3 Pro Wireless',
        transactionId: 0x1f
    },
    0x0083: {
        name: "Razer Basilsk X HyperSpeed",
        transactionId: 0x1f
    },
    0x0086: {
        name: "Razer Basilisk Ultimate",
        transactionId: 0x1f
    },
    0x0088: {
        name: "Razer Basilisk Ultimate Dongle",
        transactionId: 0x1f
    },
    0x008F: {
        name: 'Razer Naga v2 Pro Wired',
        transactionId: 0x1f
    },
    0x0090: {
        name: 'Razer Naga v2 Pro Wireless',
        transactionId: 0x1f
    },
    0x00A5: {
        name: 'Razer Viper V2 Pro Wired',
        transactionId: 0x1f
    },
    0x00A6: {
        name: 'Razer Viper V2 Pro Wireless',
        transactionId: 0x1f
    },
    0x007B: {
        name: 'Razer Viper Ultimate Wired',
        transactionId: 0x3f
    },
    0x0078: {
        name: 'Razer Viper Ultimate Wireless',
        transactionId: 0x3f
    },
    0x007A: {
        name: 'Razer Viper Ultimate Dongle',
        transactionId: 0x3f
    },
    0x0555: {
        name: 'Razer Blackshark V2 Pro RZ04-0453',
        transactionId: 0x3f
    },
    0x0528: {
        name: 'Razer Blackshark V2 Pro RZ04-0322',
        transactionId: 0x3f
    },
    0x00AF: {
        name: 'Razer Cobra Pro Wired',
        transactionId: 0x1f
    },
    0x00B0: {
        name: 'Razer Cobra Pro Wireless',
        transactionId: 0x1f
    },
};

function getMessage(transactionId) {
    // Function that creates and returns the message to be sent to the device for battery level
    let msg = Buffer.from([0x00, transactionId, 0x00, 0x00, 0x00, 0x02, 0x07, 0x80]);
    let crc = 0;

    for (let i = 2; i < msg.length; i++) {
        crc = crc ^ msg[i];
    }

    msg = Buffer.concat([msg, Buffer.alloc(80)]);
    msg = Buffer.concat([msg, Buffer.from([crc, 0])]);

    return msg;
}

function getChargeStateMessage(transactionId) {
    // Command 0x07, 0x84 queries charging state
    let msg = Buffer.from([0x00, transactionId, 0x00, 0x00, 0x00, 0x02, 0x07, 0x84]);
    let crc = 0;

    for (let i = 2; i < msg.length; i++) {
        crc = crc ^ msg[i];
    }

    msg = Buffer.concat([msg, Buffer.alloc(80)]);
    msg = Buffer.concat([msg, Buffer.from([crc, 0])]);

    return msg;
}

// Single WebUSB instance
const customWebUSB = new WebUSB({
    devicesFound: devices => {
        return devices.find(device => 
            device.vendorId === RazerVendorId && RazerProducts[device.productId] !== undefined
        );
    }
});

async function getMouse() {
    const device = await customWebUSB.requestDevice({
        filters: [{ vendorId: RazerVendorId }]
    });

    if (device) {
        return device;
    }
    throw new Error("No Razer device found");
}

async function sendCommand(msg) {
    // Helper to send a command and get response
    const mouse = await getMouse();

    await mouse.open();

    if (mouse.configuration === null) {
        await mouse.selectConfiguration(1);
    }

    await mouse.claimInterface(mouse.configuration.interfaces[0].interfaceNumber);

    await mouse.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x09,
        value: 0x300,
        index: 0x00
    }, msg);

    await new Promise(res => setTimeout(res, 500));

    const reply = await mouse.controlTransferIn({
        requestType: 'class',
        recipient: 'interface',
        request: 0x01,
        value: 0x300,
        index: 0x00
    }, 90);

    await mouse.close();

    return reply;
}

// Combined function to get both battery and charge state in one device session
async function getDeviceStatus() {
    // Simple mutex to prevent concurrent access
    if (deviceLock) {
        return null;
    }
    
    deviceLock = true;
    
    try {
        const mouse = await getMouse();
        const productInfo = RazerProducts[mouse.productId];
        
        await mouse.open();

        if (mouse.configuration === null) {
            await mouse.selectConfiguration(1);
        }

        await mouse.claimInterface(mouse.configuration.interfaces[0].interfaceNumber);

        // Get battery level
        const batteryMsg = getMessage(productInfo.transactionId);
        await mouse.controlTransferOut({
            requestType: 'class',
            recipient: 'interface',
            request: 0x09,
            value: 0x300,
            index: 0x00
        }, batteryMsg);

        await new Promise(res => setTimeout(res, 500));

        const batteryReply = await mouse.controlTransferIn({
            requestType: 'class',
            recipient: 'interface',
            request: 0x01,
            value: 0x300,
            index: 0x00
        }, 90);

        const batteryLevel = (batteryReply.data.getUint8(9) / 255 * 100).toFixed(1);

        // Get charge state
        const chargeMsg = getChargeStateMessage(productInfo.transactionId);
        await mouse.controlTransferOut({
            requestType: 'class',
            recipient: 'interface',
            request: 0x09,
            value: 0x300,
            index: 0x00
        }, chargeMsg);

        await new Promise(res => setTimeout(res, 500));

        const chargeReply = await mouse.controlTransferIn({
            requestType: 'class',
            recipient: 'interface',
            request: 0x01,
            value: 0x300,
            index: 0x00
        }, 90);

        const isCharging = chargeReply.data.getUint8(9) === 1;

        await mouse.close();

        return { batteryLevel, isCharging };
    } catch (error) {
        if (error.message?.includes("LIBUSB_ERROR_NO_DEVICE")) {
            console.warn("Device disconnected. Will retry...");
        } else if (error.name === "NotFoundError") {
            console.warn("No device found. Will retry...");
        } else {
            console.error("Error getting device status:", error.message);
        }
        return null;
    } finally {
        deviceLock = false;
    }
}

// Legacy function for backwards compatibility
async function getBattery() {
    const status = await getDeviceStatus();
    if (status) {
        chargeState = status.isCharging;
        return status.batteryLevel;
    }
    return undefined;
}

const monitorChargeState = () => {
    const checkAndUpdate = async () => {
        const status = await getDeviceStatus();
        
        if (status) {
            const stateChanged = chargeState !== status.isCharging;
            chargeState = status.isCharging;
            
            if (stateChanged) {
                console.log("Charge state changed:", chargeState ? "Charging" : "Not charging");
            }
            
            // Update tray with both battery and charge state
            const assetPath = getBatteryIconPath(status.batteryLevel, status.isCharging);
            tray.setImage(nativeImage.createFromPath(path.join(rootPath, assetPath)));
            tray.setToolTip(`${status.batteryLevel}%${status.isCharging ? ' (Charging)' : ''}`);
        }
    };

    // Poll every 15 seconds (combined battery + charge state)
    chargeMonitorInterval = setInterval(checkAndUpdate, 15000);
};
