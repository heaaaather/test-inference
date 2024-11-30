from flask import Flask, render_template, request, jsonify
import easyocr
import cv2
import numpy as np
import re
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)  # This allows all domains to access the API

@app.route('/')
def index():
    return render_template('index.html')

reader = easyocr.Reader(['en'])

@app.route('/process_plate', methods=['POST'])
def process_plate():
    try:
        # Receive image from the client
        file = request.files['image']
        file_bytes = np.frombuffer(file.read(), np.uint8)
        image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)

        # Perform OCR on the image
        results = reader.readtext(image)
        extracted_texts = [text[1] for text in results]  # Extract detected text
        
        # Clean the extracted text
        cleaned_texts = [re.sub(r'[^A-Z0-9]', '', text.upper()) for text in extracted_texts]

        return jsonify({"plate_texts": cleaned_texts})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
