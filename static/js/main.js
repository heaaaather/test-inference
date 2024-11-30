/*jshint esversion:6*/

$(function () {
    const { InferenceEngine, CVImage } = inferencejs;
    const inferEngine = new InferenceEngine();

    const video = $("video")[0];

    var workerId;
    var cameraMode = "environment"; // or "user"

    const startVideoStreamPromise = navigator.mediaDevices
        .getUserMedia({
            audio: false,
            video: {
                facingMode: cameraMode
            }
        })
        .then(function (stream) {
            return new Promise(function (resolve) {
                video.srcObject = stream;
                video.onloadeddata = function () {
                    video.play();
                    resolve();
                };
            });
        });

    const loadModelPromise = new Promise(function (resolve, reject) {
        inferEngine
            .startWorker("plate-number-recognition-prqx4", "2", "rf_KYKwCinyypbRGrwjqkTo")
            .then(function (id) {
                workerId = id;
                resolve();
            })
            .catch(reject);
    });

    Promise.all([startVideoStreamPromise, loadModelPromise]).then(function () {
        $("body").removeClass("loading");
        resizeCanvas();
        detectFrame();
    });

    var canvas, ctx;
    const font = "16px sans-serif";

    function videoDimensions(video) {
        // Ratio of the video's intrisic dimensions
        var videoRatio = video.videoWidth / video.videoHeight;

        // The width and height of the video element
        var width = video.offsetWidth,
            height = video.offsetHeight;

        // The ratio of the element's width to its height
        var elementRatio = width / height;

        // If the video element is short and wide
        if (elementRatio > videoRatio) {
            width = height * videoRatio;
        } else {
            // It must be tall and thin, or exactly equal to the original ratio
            height = width / videoRatio;
        }

        return {
            width: width,
            height: height
        };
    }

    $(window).resize(function () {
        resizeCanvas();
    });

    const resizeCanvas = function () {
        $("canvas").remove();

        canvas = $("<canvas/>");

        ctx = canvas[0].getContext("2d");

        var dimensions = videoDimensions(video);

        console.log(
            video.videoWidth,
            video.videoHeight,
            video.offsetWidth,
            video.offsetHeight,
            dimensions
        );

        canvas[0].width = video.videoWidth;
        canvas[0].height = video.videoHeight;

        canvas.css({
            width: dimensions.width,
            height: dimensions.height,
            left: ($(window).width() - dimensions.width) / 2,
            top: ($(window).height() - dimensions.height) / 2
        });

        $("body").append(canvas);
    };

    const cleanPlateText = (text) => {
        return text.replace(/[^A-Z0-9]/g, ''); // Keep only A-Z and 0-9
    };
    
    const extractPlateText = async (croppedImageBlob) => {
        const formData = new FormData();
        formData.append('image', croppedImageBlob);
    
        try {
            const response = await fetch('/process_plate', {
                method: 'POST',
                body: formData,
            });
    
            const result = await response.json();
            if (result.plate_texts) {
                // Clean the texts
                const cleanedTexts = result.plate_texts.map(cleanPlateText);
                console.log("Cleaned Texts:", cleanedTexts);
                return cleanedTexts.join(", ");
            } else {
                console.error("OCR Error:", result.error);
                return "Error extracting text";
            }
        } catch (err) {
            console.error("Request failed:", err);
            return "Error extracting text";
        }
    };
    
    let lastDetectedPlate = ""; // Stores the last detected plate
    let interval = 5000; // Interval in milliseconds (5 seconds)
    let lastUpdateTime = 0; // Track the last update time

    // Plate validation function (equivalent to your Python validation in JavaScript)
    function validatePlate(text, vehicleType) {
        text = text.replace(/[^A-Z0-9]/g, ""); // Remove invalid characters

        const FOUR_WHEELED_FORMAT = /^[A-Z]{3}\d{4}$/;
        const TWO_WHEELED_FORMAT = /^\d{3}[A-Z]{3}$|^[A-Z]{1}\d{3}[A-Z]{2}$/;

        if (vehicleType === "both") {
            if (FOUR_WHEELED_FORMAT.test(text)) return { plate: text, type: "Four Wheeled" };
            if (TWO_WHEELED_FORMAT.test(text)) return { plate: text, type: "Two Wheeled" };
        } else if (vehicleType === "Four Wheeled") {
            if (FOUR_WHEELED_FORMAT.test(text)) return { plate: text, type: "Four Wheeled" };
        } else if (vehicleType === "Two Wheeled") {
            if (TWO_WHEELED_FORMAT.test(text)) return { plate: text, type: "Two Wheeled" };
        }
        return { plate: "Invalid plate format", type: "Unknown" };
    }

    const renderPredictions = async function (predictions) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        for (const prediction of predictions) {
            const x = prediction.bbox.x;
            const y = prediction.bbox.y;
            const width = prediction.bbox.width;
            const height = prediction.bbox.height;

            // Draw bounding box
            ctx.strokeStyle = prediction.color;
            ctx.lineWidth = 4;
            ctx.strokeRect(x - width / 2, y - height / 2, width, height);

            // Crop the detected region
            const croppedCanvas = document.createElement('canvas');
            const croppedCtx = croppedCanvas.getContext('2d');
            croppedCanvas.width = width;
            croppedCanvas.height = height;
            croppedCtx.drawImage(
                video,
                x - width / 2, y - height / 2, width, height,
                0, 0, width, height
            );

            // Convert cropped canvas to Blob
            const croppedBlob = await new Promise(resolve =>
                croppedCanvas.toBlob(resolve, 'image/jpeg')
            );

            // Perform OCR
            const plateText = await extractPlateText(croppedBlob);
            const validatedPlate = validatePlate(plateText, "both");
            const currentTime = Date.now();

            // Only update if the interval has passed and the plate is valid and new
            if (
                currentTime - lastUpdateTime > interval &&
                validatedPlate.plate !== lastDetectedPlate &&
                validatedPlate.type !== "Unknown"
            ) {
                lastDetectedPlate = validatedPlate.plate; // Update last detected plate
                lastUpdateTime = currentTime; // Update last update time
                console.log("Displaying Plate:", validatedPlate.plate, validatedPlate.type);

                // Display the detected plate (example: updating a DOM element)
                const plateDisplay = document.getElementById("plate-display");
                plateDisplay.innerText = `Detected Plate: ${validatedPlate.plate} (${validatedPlate.type})`;
            }

            // Optionally, draw the label on the canvas
            ctx.fillStyle = "yellow";
            ctx.font = font;
            ctx.fillText(lastDetectedPlate, x - width / 2, y - height / 2 - 10);
        }
    };

    var prevTime;
    var pastFrameTimes = [];
    const detectFrame = function () {
        if (!workerId) return requestAnimationFrame(detectFrame);

        const image = new CVImage(video);
        inferEngine
            .infer(workerId, image)
            .then(function (predictions) {
                requestAnimationFrame(detectFrame);
                renderPredictions(predictions);

                if (prevTime) {
                    pastFrameTimes.push(Date.now() - prevTime);
                    if (pastFrameTimes.length > 30) pastFrameTimes.shift();

                    var total = 0;
                    _.each(pastFrameTimes, function (t) {
                        total += t / 1000;
                    });

                    var fps = pastFrameTimes.length / total;
                    $("#fps").text(Math.round(fps));
                }
                prevTime = Date.now();
            })
            .catch(function (e) {
                console.log("CAUGHT", e);
                requestAnimationFrame(detectFrame);
            });
    };
});
