const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Using Axios for API requests
const wav = require('wav');

const app = express();
const port = 5000;

// AssemblyAI API Key
const API_KEY = "795e48ee75f64a1b8caf28dfba50e1a3";

// Middleware to handle raw audio file upload
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

let lastAudioPath = null;

// Function to convert raw PCM to WAV
function convertPCMToWAV(pcmBuffer, outputFilePath) {
    return new Promise((resolve, reject) => {
        try {
            const writer = new wav.FileWriter(outputFilePath, {
                channels: 1,
                sampleRate: 16000,
                bitDepth: 8
            });

            writer.write(pcmBuffer);
            writer.end();

            writer.on('finish', () => resolve());
            writer.on('error', (err) => reject(err));
        } catch (err) {
            reject(err);
        }
    });
}

// Endpoint to receive raw PCM audio from ESP32
app.post('/upload', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file received');
    }

    console.log('Audio data received:', req.file.buffer.length, 'bytes');

    // Save PCM as WAV
    lastAudioPath = path.join(__dirname, 'audio.wav');
    try {
        await convertPCMToWAV(req.file.buffer, lastAudioPath);
        res.send('Audio received and converted to WAV successfully');
    } catch (error) {
        console.error('Error converting PCM to WAV:', error);
        res.status(500).send('Error processing audio file');
    }
});

// Function to upload file to AssemblyAI
async function uploadFile(filePath) {
    try {
        const response = await axios.post(
            "https://api.assemblyai.com/v2/upload",
            fs.createReadStream(filePath),
            { headers: { "Authorization": API_KEY } }
        );
        return response.data.upload_url;
    } catch (error) {
        console.error("Error uploading file to AssemblyAI:", error);
        throw new Error("File upload failed");
    }
}

// Function to transcribe audio using AssemblyAI
async function getTranscription(audioUrl) {
    try {
        const response = await axios.post(
            "https://api.assemblyai.com/v2/transcript",
            { audio_url: audioUrl },
            { headers: { "Authorization": API_KEY, "Content-Type": "application/json" } }
        );
        return response.data.id;
    } catch (error) {
        console.error("Error requesting transcription:", error);
        throw new Error("Transcription request failed");
    }
}

// Function to fetch transcript text from AssemblyAI
async function fetchTranscriptText(transcriptId) {
    while (true) {
        await new Promise(res => setTimeout(res, 5000)); // Wait for processing

        const response = await axios.get(
            `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
            { headers: { "Authorization": API_KEY } }
        );

        if (response.data.status === "completed") {
            return response.data.text;
        } else if (response.data.status === "failed") {
            throw new Error("Transcription failed");
        }
    }
}

// Endpoint to transcribe the WAV file using AssemblyAI
app.get('/gettext', async (req, res) => {
    if (!lastAudioPath) {
        return res.send('No audio file received yet');
    }

    try {
        // Upload file to AssemblyAI
        const audioUrl = await uploadFile(lastAudioPath);

        // Request transcription
        const transcriptId = await getTranscription(audioUrl);

        // Fetch transcription text
        const transcriptText = await fetchTranscriptText(transcriptId);

        console.log('Transcription:', transcriptText);
        res.send(transcriptText);
    } catch (error) {
        console.error('Error during transcription:', error);
        res.status(500).send('Error processing transcription');
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
