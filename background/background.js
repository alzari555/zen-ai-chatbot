// Zen AI Sidebar — Background Script
// Orchestrates communication and makes Gemini API calls

(function () {
  "use strict";

  const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
  const DEEPSEEK_API_BASE = "https://api.deepseek.com/chat/completions";
  const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1/chat/completions";

  // Get App Config from storage
  async function getAppConfig() {
    const result = await browser.storage.local.get(["geminiApiKey", "deepseekApiKey", "openRouterApiKey", "geminiModel"]);
    return {
      geminiApiKey: result.geminiApiKey || null,
      deepseekApiKey: result.deepseekApiKey || null,
      openRouterApiKey: result.openRouterApiKey || null,
      model: result.geminiModel || "gemini-2.5-flash",
    };
  }

  // Get page content from active tab's content script
  async function getPageContext() {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tabs || tabs.length === 0) return null;

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: "GET_PAGE_CONTENT",
      });
      return response;
    } catch (e) {
      console.warn("Could not get page content:", e.message);
      return null;
    }
  }

  // Get selection from active tab
  async function getSelection() {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tabs || tabs.length === 0) return "";

      const response = await browser.tabs.sendMessage(tabs[0].id, {
        type: "GET_SELECTION",
      });
      return response?.selection || "";
    } catch (e) {
      return "";
    }
  }

  // Build system prompt with page context
  function buildSystemPrompt(pageContext, selection) {
    let systemPrompt =
      `You are Zen AI, an intelligent assistant embedded in the user's browser sidebar. ` +
      `You help users understand, summarize, and interact with web content. ` +
      `Be concise, helpful, and direct. Use markdown formatting in your responses.`;

    if (pageContext) {
      systemPrompt += `\n\n--- CURRENT PAGE CONTEXT ---`;
      systemPrompt += `\nTitle: ${pageContext.meta?.title || "Unknown"}`;
      systemPrompt += `\nURL: ${pageContext.meta?.url || "Unknown"}`;
      if (pageContext.meta?.description) {
        systemPrompt += `\nDescription: ${pageContext.meta.description}`;
      }
      systemPrompt += `\n\nPage Content:\n${pageContext.content}`;
      systemPrompt += `\n--- END PAGE CONTEXT ---`;
    }

    if (selection) {
      systemPrompt += `\n\n--- HIGHLIGHTED TEXT ---\n${selection}\n--- END HIGHLIGHTED TEXT ---`;
    }

    return systemPrompt;
  }

  // Stream response from Gemini API
  async function streamGeminiResponse(apiKey, model, systemPrompt, userMessage, conversationHistory, sendChunk) {
    const url = `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // Build contents array with conversation history
    const contents = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      });
    }

    // Add current user message
    contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              fullResponse += text;
              sendChunk(text);
            }
          } catch (e) {
            // Partial JSON, skip
          }
        }
      }
    }

    return fullResponse;
  }

  // Stream response from OpenAI-Compatible API (Deepseek, OpenRouter)
  async function streamOpenAICompatibleResponse(apiBase, apiKey, model, systemPrompt, userMessage, conversationHistory, sendChunk) {
    const contents = [];

    // Add system prompt
    if (systemPrompt) {
      contents.push({ role: "system", content: systemPrompt });
    }

    // Add conversation history
    for (const msg of conversationHistory) {
      contents.push({ role: msg.role === "model" ? "assistant" : "user", content: msg.text });
    }

    // Add current user message
    contents.push({ role: "user", content: userMessage });

    const body = {
      model: model,
      messages: contents,
      stream: true,
      temperature: 0.7,
      max_tokens: 8192,
    };

    const response = await fetch(apiBase, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error (${response.status}): ${error}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const text = parsed?.choices?.[0]?.delta?.content;
            if (text) {
              fullResponse += text;
              sendChunk(text);
            }
          } catch (e) {
            // Error parsing JSON fragment
          }
        }
      }
    }

    return fullResponse;
  }

  // Handle messages from sidebar
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "SELECTION_CHANGED") {
      // Forward selection changes to sidebar
      browser.runtime
        .sendMessage({
          type: "SELECTION_UPDATE",
          selection: message.selection,
        })
        .catch(() => { });
      return false;
    }

    if (message.type === "CHAT_REQUEST") {
      handleChatRequest(message, sender);
      return false; // Response sent via streaming messages
    }

    if (message.type === "GET_CONTEXT") {
      handleGetContext().then(sendResponse);
      return true;
    }

    return false;
  });

  async function handleGetContext() {
    const pageContext = await getPageContext();
    const selection = await getSelection();
    return { pageContext, selection };
  }

  async function handleChatRequest(message) {
    const { userMessage, action, conversationHistory = [] } = message;
    const requestId = message.requestId;

    try {
      const config = await getAppConfig();
      const isDeepseek = config.model.startsWith("deepseek");
      const isOpenRouter = config.model.startsWith("openrouter:");

      let actualModel = config.model;
      if (isOpenRouter) {
        actualModel = config.model.replace("openrouter:", "");
      }

      if (isDeepseek && !config.deepseekApiKey) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          error: "NO_API_KEY",
          message: "Please set your Deepseek API key in the sidebar settings.",
        });
        return;
      } else if (isOpenRouter && !config.openRouterApiKey) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          error: "NO_API_KEY",
          message: "Please set your OpenRouter API key in the sidebar settings.",
        });
        return;
      } else if (!isDeepseek && !isOpenRouter && !config.geminiApiKey) {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          error: "NO_API_KEY",
          message: "Please set your Gemini API key in the sidebar settings.",
        });
        return;
      }

      // Get page context
      const pageContext = await getPageContext();
      const selection = await getSelection();
      const systemPrompt = buildSystemPrompt(pageContext, selection);

      // Determine user message based on action
      let finalMessage = userMessage;
      if (action === "summarize") {
        finalMessage =
          "Please provide a comprehensive summary of this page's content. Highlight the key points and main takeaways.";
      } else if (action === "explain") {
        if (selection) {
          finalMessage = `Please explain the following highlighted text in detail:\n\n"${selection}"`;
        } else {
          finalMessage = "Please explain the main concepts on this page in simple terms.";
        }
      } else if (action === "keypoints") {
        finalMessage =
          "Extract and list the key points from this page as a bullet-point list. Be specific and actionable.";
      }

      // Stream response
      const streamCallback = (chunk) => {
        browser.runtime.sendMessage({
          type: "CHAT_RESPONSE",
          requestId,
          chunk,
          done: false,
        }).catch(() => { });
      };

      if (isDeepseek) {
        await streamOpenAICompatibleResponse(DEEPSEEK_API_BASE, config.deepseekApiKey, actualModel, systemPrompt, finalMessage, conversationHistory, streamCallback);
      } else if (isOpenRouter) {
        await streamOpenAICompatibleResponse(OPENROUTER_API_BASE, config.openRouterApiKey, actualModel, systemPrompt, finalMessage, conversationHistory, streamCallback);
      } else {
        await streamGeminiResponse(config.geminiApiKey, actualModel, systemPrompt, finalMessage, conversationHistory, streamCallback);
      }

      // Signal completion
      browser.runtime.sendMessage({
        type: "CHAT_RESPONSE",
        requestId,
        done: true,
      }).catch(() => { });
    } catch (error) {
      browser.runtime.sendMessage({
        type: "CHAT_RESPONSE",
        requestId,
        error: "API_ERROR",
        message: error.message,
      }).catch(() => { });
    }
  }
})();
