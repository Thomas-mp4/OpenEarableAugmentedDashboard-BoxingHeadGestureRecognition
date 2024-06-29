class Window {
  constructor(windowSize, sensorType, overlapSize = 0) {
    /**
     * Helper class to represent a window of sensor data from a single sensor type.
     * (e.g. accelerometer, gyroscope)
     * Is able to 'slide' (i.e. pull the last n data points to the front, and discard the rest)
     * @param windowSize The size of the window
     * @param sensorType The type of sensor data (e.g. "accelerometer")
     * @param overlapSize The size of the overlap between windows
     */
    this.windowSize = windowSize;
    this.sensorType = sensorType;
    this.overlapSize = overlapSize || 0;

    // Initialize empty data lists
    this.x = [];
    this.y = [];
    this.z = [];
  }

  getLength() {
    /**
     * @returns the number of data points currently stored in the window (based on the x-axis data).
     */
    return this.x.length;
  }

  getMaxLength() {
    /**
     * @returns the maximum number of data points that can be stored in the window.
     */
    return this.windowSize;
  }

  toString() {
    return `SlidingWindowObject(${this.sensorType}, size=${this.windowSize}, currentLength=${this.getLength()})`;
  }

  isFull() {
    /**
     * Checks if the window is full (i.e. contains the maximum number of data points).
     * @returns True if the window is full, false otherwise
     */
    return this.x.length >= this.windowSize;
  }

  addData(x, y, z) {
    if (this.isFull()) throw new Error("Window is full");
    this.x.push(x);
    this.y.push(y);
    this.z.push(z);
  }

  getAxisFeatures(axisData) {
    /**
     * Extracts features from a single axis of sensor data stored in the window.
     * @param axis_data The array of sensor data along a single axis
     */
    // Get the length of the axis data
    const axisLength = axisData.length;

    // Calculate mean
    let sum = 0;
    for (let i = 0; i < axisLength; i++) {
      sum += axisData[i];
    }
    const mean = sum / axisLength;

    // Calculate min and max
    const min = Math.min(...axisData);
    const max = Math.max(...axisData);

    // Return the calculated features
    return { mean, min, max };
  }

  extractFeatures() {
    /**
     * @returns A dictionary containing the extracted features for each axis (x, y, z)
     */
    return {
      x: this.x.length
        ? this.getAxisFeatures(this.x)
        : { mean: NaN, min: NaN, max: NaN },
      y: this.y.length
        ? this.getAxisFeatures(this.y)
        : { mean: NaN, min: NaN, max: NaN },
      z: this.z.length
        ? this.getAxisFeatures(this.z)
        : { mean: NaN, min: NaN, max: NaN },
    };
  }

  slide() {
    /**
     * Discards the first n (windowSize) data points and pulls the last n (windowSize) data points to the front
     */
    if (this.x.length < this.windowSize) throw new Error("Window is not full");
    this.x = this.x.slice(this.windowSize - this.overlapSize);
    this.y = this.y.slice(this.windowSize - this.overlapSize);
    this.z = this.z.slice(this.windowSize - this.overlapSize);
  }
}

class SensorDataHandler {
  constructor(windowSize, overlapSize) {
    this.accWindow = new Window(windowSize, "accelerometer", overlapSize);
    this.gyroWindow = new Window(windowSize, "gyroscope", overlapSize);
  }

  handleData(acc, gyro) {
    /**
     * Processes incoming sensor data. Extracts features from the data if the windows are full.
     *
     * @param acc The accelerometer data (x, y, z)
     * @param gyro The gyroscope data (x, y, z)
     * @return An object containing the extracted features (mean, std, min, max) for each sensor type (acc, gyro)
     * or null if the windows are not full.
     */
    this.accWindow.addData(...acc);
    this.gyroWindow.addData(...gyro);

    if (this.accWindow.isFull() && this.gyroWindow.isFull()) {
      const features = {
        accelerometer: this.accWindow.extractFeatures(),
        gyroscope: this.gyroWindow.extractFeatures(),
      };
      this.accWindow.slide();
      this.gyroWindow.slide();
      return features;
    }
    return null;
  }
}

function updateProgressBar() {
  /**
   * Updates the progress bar based on the length of the sliding window.
   */
  const progressBar = document.getElementById("progressBar");
  const windowLength = sensorDataHandler.accWindow.getLength();
  const windowSize = sensorDataHandler.accWindow.getMaxLength();
  progressBar.style.width = (windowLength / windowSize) * 100 + "%";
}

function makeInferenceAPICall(features) {
  /**
   * Makes a POST request to the inference API with the extracted features.
   * @param features The extracted features from the sensor data
   */
  const apiUrl = "http://localhost:5000/predict";
  const requestOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(features),
  };

  fetch(apiUrl, requestOptions)
    .then((response) => response.json())
    .then((data) => {
      // 0 = idle, 1 = left slip, 2 = right slip, 3 left roll, 4 = right roll, 5 = pull back
      // Translate result to human-readable gesture
      let gesture = "Unknown";
      switch (data.prediction) {
        case 0:
          gesture = "Idle";
          break;
        case 1:
          gesture = "Left Slip";
          break;
        case 2:
          gesture = "Right Slip";
          break;
        case 3:
          gesture = "Left Roll";
          break;
        case 4:
          gesture = "Right Roll";
          break;
        case 5:
          gesture = "Pull Back";
          break;
        default:
          gesture = "Unknown";
      }
      log(`Predicted gesture: ${gesture}`, "SUCCESS", "predictionLog");
    })
    .catch((error) => {
      log(`Error: ${error} (is the server running?)`, "ERROR", "predictionLog");
    });
}

// Set up a listener for sensor data
openEarable.sensorManager.subscribeOnSensorDataReceived((sensorData) => {
  // Only process data from the IMU sensor
  if (sensorData.sensorId !== 0) return;

  // Extract the data
  const accData = {
    X: sensorData.ACC.X,
    Y: sensorData.ACC.Y,
    Z: sensorData.ACC.Z,
  };
  const gyroData = {
    X: sensorData.GYRO.X,
    Y: sensorData.GYRO.Y,
    Z: sensorData.GYRO.Z,
  };

  // Process the data
  processDataV2(accData, gyroData);
});

// Define the function to process the sensor data
let accSequence = [];
let gyroSequence = [];
let collectingData = false;
let inThresholdCounter = 0;
let aboveThresholdCounter = 0;

const gyroscopeYThreshold = 1.5;
const anomalyEndThresholdLow = -1;
const anomalyEndThresholdHigh = 1;
const startThresholdCount = 1; // Consecutive samples above the threshold to start collecting
const minimumAnomalyLength = 20; // Minimum samples to consider an anomaly
const counterThreshold = 5; // Consecutive samples within the end threshold to stop collecting

function processDataV2(accData, gyroData) {
  // Anomaly detection
  if (Math.abs(gyroData.Y) > gyroscopeYThreshold) {
    aboveThresholdCounter += 1;
  } else {
    aboveThresholdCounter = 0; // Reset if the value falls below threshold at any point
  }

  // If anomaly is detected, start collecting data
  if (aboveThresholdCounter >= startThresholdCount) {
    if (!collectingData) {
      collectingData = true;
      console.log("\nAnomaly found: collecting data.");
      // Start of anomaly detected: reset sequences and counters
      accSequence = [];
      gyroSequence = [];
      inThresholdCounter = 0; // Reset end threshold counter
    }
  }

  // Mid-anomaly data collection
  if (collectingData) {
    gyroSequence.push(-gyroData.Y); // Data is inverted, revert it back
    accSequence.push(accData.X);

    // Check if the data falls within the end thresholds
    if (
      anomalyEndThresholdLow <= gyroData.Y &&
      gyroData.Y <= anomalyEndThresholdHigh
    ) {
      inThresholdCounter += 1;
    } else {
      inThresholdCounter = 0; // Reset counter if data goes out of threshold range
    }

    // Stop collecting data if the condition of 5 samples within threshold is met
    if (inThresholdCounter >= counterThreshold) {
      collectingData = false;
      if (gyroSequence.length >= minimumAnomalyLength) {
        // Append the two sequences together
        const unknownSequence = gyroSequence.concat(accSequence);
        const task = makePredictionV2(unknownSequence); // Assuming makePredictionV2 returns a promise
      } else {
        console.log(
          `Anomaly ended. Data collected was too short (${gyroSequence.length} samples).`,
        );
      }
      // Reset sequences and counters for next detection
      accSequence = [];
      gyroSequence = [];
    }
  }
}

async function makePredictionV2(sequence) {
  const apiUrl = "http://localhost:5000/predict";
  const requestOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sequence),
  };

  fetch(apiUrl, requestOptions)
    .then((response) => response.json())
    .then((data) => {
      // 0 = idle, 1 = left slip, 2 = right slip, 3 left roll, 4 = right roll, 5 = pull back
      // Translate result to human-readable gesture
      let gesture = "Unknown";

      switch (data.prediction) {
        case "Left Slip":
          playAnimation("leftslip_model");
          break;
        case "Right Slip":
          playAnimation("rightslip_model");
          break;
        case "Left Roll":
          playAnimation("leftroll_model");
          break;
        case "Right Roll":
          playAnimation("rightroll_model");
          break;
        case "Pull Back":
          playAnimation("pullback_model");
          break;
        default:
          gesture = "Unknown";
      }

      console.log(`Predicted gesture: ${data.prediction}`);
    })
    .catch((error) => {
      console.log(`Error: ${error} (is the server running?)`);
    });
}

// ---------------------------- V MODEL ANIMATIONS V ------------------------------------

let isAnimationPlaying = false;

function playAnimation(modelID) {
  // Ignore the request if an animation is currently playing and it's not the idle model
  if (isAnimationPlaying && modelID !== "idle_model") {
    return;
  }

  // Find the model and its indicator
  const model = document.getElementById(modelID);
  const indicator = document.getElementById(`${modelID}_indicator`);

  // Set the flag indicating that an animation is playing
  isAnimationPlaying = true;

  // Hide the idle model and dim its indicator
  document.getElementById("idle_model").style.height = "0";
  document.getElementById("idle_model_indicator").style.opacity = "30%";

  // Display the desired model and brighten its indicator
  model.style.height = "30vh";
  indicator.style.opacity = "100%";

  // Reset and play the model's animation
  model.currentTime = 0;
  model.play({ repetitions: 1 });

  // Listen for when the animation finishes
  model.addEventListener("finished", () => switchBackToIdle(modelID));
}

function switchBackToIdle(modelID) {
  // Hide the current model and dim its indicator
  const model = document.getElementById(modelID);
  const indicator = document.getElementById(`${modelID}_indicator`);
  model.style.height = "0";
  indicator.style.opacity = "30%";

  // Display the idle model and brighten its indicator
  document.getElementById("idle_model").style.height = "30vh";
  document.getElementById("idle_model_indicator").style.opacity = "100%";

  // Reset the animation playing flag
  isAnimationPlaying = false;
}

// Get references to all the model-viewer elements
const idleModel = document.getElementById("idle_model");
const leftslipModel = document.getElementById("leftslip_model");
const rightslipModel = document.getElementById("rightslip_model");
const leftrollModel = document.getElementById("leftroll_model");
const rightrollModel = document.getElementById("rightroll_model");
const pullbackModel = document.getElementById("pullback_model");

// Function to update the camera orbit of all model viewers except the source
function updateAllCameras(sourceModel) {
  const orbit = sourceModel.getCameraOrbit();
  const formattedOrbit = `${orbit.theta}rad ${orbit.phi}rad ${orbit.radius}m`;

  [
    leftslipModel,
    rightslipModel,
    leftrollModel,
    rightrollModel,
    pullbackModel,
  ].forEach((model) => {
    if (model !== sourceModel) {
      model.cameraOrbit = formattedOrbit;
      model.jumpCameraToGoal();
    }
  });
}

// Function to reset the camera orientation of all model viewers
function resetCameraOrientations() {
  // Keep the current radius but reset the angles to face the front
  [
    idleModel,
    leftslipModel,
    rightslipModel,
    leftrollModel,
    rightrollModel,
    pullbackModel,
  ].forEach((model) => {
    const currentOrbit = model.getCameraOrbit();
    const defaultOrbit = `0rad 90deg ${currentOrbit.radius}m`; // This keeps the current zoom level constant
    model.cameraOrbit = defaultOrbit;
    model.jumpCameraToGoal();
  });
}

// Attach the event listener to the idle_model only
idleModel.addEventListener("camera-change", () => updateAllCameras(idleModel));
