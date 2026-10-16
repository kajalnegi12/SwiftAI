import axios from "axios"
import Chat from "../models/Chat.js"
import User from "../models/User.js"
import imagekit from "../configs/imageKit.js"
import openai from '../configs/openai.js'


// Text-based AI Chat Message Controller
export const textMessageController = async (req, res) => {
    try {
        const userId = req.user._id

         // Check credits
        if(req.user.credits < 1){
            return res.json({success: false, message: "You don't have enough credits to use this feature"})
        }

        const {chatId, prompt} = req.body

        const chat = await Chat.findOne({userId, _id: chatId})
        chat.messages.push({role: "user", content: prompt, timestamp: Date.now(), isImage: false})

        const { choices } = await openai.chat.completions.create({
        model: "gemini-2.5-flash",
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],
    });

    const reply = {...choices[0].message, timestamp: Date.now(), isImage: false}
    res.json({success: true, reply})

    chat.messages.push(reply)
    await chat.save()
    await User.updateOne({_id: userId}, {$inc: {credits: -1}})

    } catch (error) {
        res.json({success: false, message: error.message})
    }
}

// Image Generation Message Controller

export const imageMessageController = async (req, res) => {
    try {
        const userId = req.user._id;
        const { prompt, chatId, isPublished } = req.body;

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                message: "Please enter an image prompt."
            });
        }

        if (req.user.credits < 2) {
            return res.status(400).json({
                success: false,
                message: "You don't have enough credits to generate an image."
            });
        }

        const chat = await Chat.findOne({
            userId,
            _id: chatId
        });

        if (!chat) {
            return res.status(404).json({
                success: false,
                message: "Chat not found."
            });
        }

        const endpoint = process.env.IMAGEKIT_URL_ENDPOINT?.replace(/\/+$/, "");

        if (!endpoint) {
            throw new Error("IMAGEKIT_URL_ENDPOINT is missing in environment variables.");
        }

        // Use a unique filename for every generation request.
        const fileName = `image-${Date.now()}.png`;
        const encodedPrompt = encodeURIComponent(prompt.trim());

        const generatedUrl =
            `${endpoint}/ik-genimg-prompt-${encodedPrompt}/quickgpt/${fileName}`;

        let imageReady = false;
        let lastError = "ImageKit has not returned an image yet.";

        // ImageKit may return a temporary HTML response while generating.
        // Retry briefly; do not save a broken image URL.
        for (let attempt = 1; attempt <= 4; attempt++) {
            try {
                const response = await axios.get(generatedUrl, {
                    responseType: "arraybuffer",
                    timeout: 2500,
                    validateStatus: () => true
                });

                const contentType =
                    response.headers["content-type"] || "";

                const intermediate =
                    String(
                        response.headers["is-intermediate-response"] || ""
                    ).toLowerCase() === "true";

                if (
                    response.status >= 200 &&
                    response.status < 300 &&
                    contentType.toLowerCase().startsWith("image/") &&
                    !intermediate
                ) {
                    imageReady = true;
                    break;
                }

                const responseText = Buffer
                    .from(response.data || [])
                    .toString("utf8")
                    .slice(0, 300);

                lastError = intermediate
                    ? "ImageKit is still preparing the image."
                    : `ImageKit returned HTTP ${response.status}, content-type: ${contentType}. ${responseText}`;
            } catch (error) {
                lastError = error.message;
            }

            if (attempt < 4) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (!imageReady) {
            console.error("ImageKit generation failed:", lastError);

            return res.status(502).json({
                success: false,
                message: "Image is not ready yet. Please wait a few minutes and try again.",
                error: lastError
            });
        }

        // Save only after ImageKit returns actual image data.
        const reply = {
            role: "assistant",
            content: generatedUrl,
            timestamp: Date.now(),
            isImage: true,
            isPublished: Boolean(isPublished)
        };

        chat.messages.push({
            role: "user",
            content: prompt.trim(),
            timestamp: Date.now(),
            isImage: false
        });

        chat.messages.push(reply);
        await chat.save();

        await User.updateOne(
            { _id: userId },
            { $inc: { credits: -2 } }
        );

        return res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error("Image generation error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Image generation failed."
        });
    }
};
