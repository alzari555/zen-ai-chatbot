// Zen AI Sidebar — Sidebar UI Logic
// Handles chat, quick actions, settings, and message streaming

(function () {
  "use strict";

  // ===== State =====
  let conversationHistory = [];
  let currentSelection = "";
  let isStreaming = false;
  let currentRequestId = 0;

  // ===== DOM Elements =====
  const messagesArea = document.getElementById("messagesArea");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const clearBtn = document.getElementById("clearBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const settingsClose = document.getElementById("settingsClose");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const deepseekApiKeyInput = document.getElementById("deepseekApiKeyInput");
  const openRouterApiKeyInput = document.getElementById("openRouterApiKeyInput");
  const modelSelect = document.getElementById("modelSelect");
  const compressorModelSelect = document.getElementById("compressorModelSelect");
  const toggleKeyVisibility = document.getElementById("toggleKeyVisibility");
  const toggleDeepseekKeyVisibility = document.getElementById("toggleDeepseekKeyVisibility");
  const toggleOpenRouterKeyVisibility = document.getElementById("toggleOpenRouterKeyVisibility");
  const saveSettingsBtn = document.getElementById("saveSettings");
  const saveStatus = document.getElementById("saveStatus");
  const contextBar = document.getElementById("contextBar");
  const contextText = document.getElementById("contextText");
  const inspectContextBtn = document.getElementById("inspectContextBtn");
  const compressContextBtn = document.getElementById("compressContextBtn");
  const selectionBanner = document.getElementById("selectionBanner");
  const selectionText = document.getElementById("selectionText");
  const selectionDismiss = document.getElementById("selectionDismiss");
  const quickActions = document.getElementById("quickActions");

  // ===== Init =====
  async function init() {
    await loadTheme();
    loadSettings();
    updateContextBar();
    setupEventListeners();
    loadOpenRouterModels();
  }

  // ===== Dynamic Models =====
  async function loadOpenRouterModels() {
    const group = document.getElementById("openRouterGroup");
    const compressorGroup = document.getElementById("compressorOpenRouterGroup");
    if (!group) return;

    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      const data = await response.json();
      
      // Preserve the auto options and reset the rest
      group.innerHTML = `
        <option value="openrouter:openrouter/free">Auto (Free Models)</option>
        <option value="openrouter:openrouter/auto">Auto (Best Model)</option>
      `;
      if (compressorGroup) {
        compressorGroup.innerHTML = `<option value="openrouter:openrouter/free">Auto (Free Models)</option>`;
      }

      // Sort models alphabetically
      const models = data.data.sort((a, b) => a.name.localeCompare(b.name));
      
      models.forEach(model => {
        const option = document.createElement("option");
        option.value = `openrouter:${model.id}`;
        
        let label = model.name;
        // Optionally flag models that are completely free based on OpenRouter response structure
        if (model.pricing && (model.pricing.prompt === "0" || model.pricing.prompt === 0) && (model.pricing.completion === "0" || model.pricing.completion === 0)) {
          label += " (Free)";
        }
        
        option.textContent = label;
        group.appendChild(option);
        
        if (compressorGroup) {
          const compOption = document.createElement("option");
          compOption.value = `openrouter:${model.id}`;
          compOption.textContent = label;
          compressorGroup.appendChild(compOption);
        }
      });
      
      // Re-apply selected model in case the previously selected model was overridden during DOM reset
      const result = await browser.storage.local.get(["geminiModel", "compressorModel"]);
      if (result.geminiModel && result.geminiModel.startsWith("openrouter:")) {
        modelSelect.value = result.geminiModel;
      }
      if (result.compressorModel && result.compressorModel.startsWith("openrouter:")) {
        compressorModelSelect.value = result.compressorModel;
      }
    } catch (e) {
      console.warn("Failed to load OpenRouter models dynamically", e);
    }
  }

  // ===== Theme =====
  function getSystemTheme() {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      return "light";
    }
  }

  function applyTheme(theme) {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    document.documentElement.setAttribute("data-theme", resolved);
  }

  async function loadTheme() {
    try {
      const result = await browser.storage.local.get("sidebarTheme");
      const theme = result.sidebarTheme || "system";
      applyTheme(theme);
      return theme;
    } catch (e) {
      applyTheme("light");
      return "light";
    }
  }

  function updateThemeButtons(activeValue) {
    document.querySelectorAll(".theme-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeValue === activeValue);
    });
  }

  // ===== Settings =====
  async function loadSettings() {
    try {
      const result = await browser.storage.local.get(["geminiApiKey", "deepseekApiKey", "openRouterApiKey", "geminiModel", "compressorModel", "sidebarTheme"]);
      if (result.geminiApiKey) {
        apiKeyInput.value = result.geminiApiKey;
      }
      if (result.deepseekApiKey) {
        deepseekApiKeyInput.value = result.deepseekApiKey;
      }
      if (result.openRouterApiKey) {
        openRouterApiKeyInput.value = result.openRouterApiKey;
      }
      if (result.geminiModel) {
        modelSelect.value = result.geminiModel;
      }
      if (result.compressorModel) {
        compressorModelSelect.value = result.compressorModel;
      }
      updateThemeButtons(result.sidebarTheme || "system");
    } catch (e) {
      console.warn("Could not load settings:", e);
      updateThemeButtons("system");
    }
  }

  async function saveSettings() {
    const apiKey = apiKeyInput.value.trim();
    const deepseekApiKey = deepseekApiKeyInput.value.trim();
    const openRouterApiKey = openRouterApiKeyInput.value.trim();
    const model = modelSelect.value;
    const compModel = compressorModelSelect.value;
    const activeThemeBtn = document.querySelector(".theme-option.active");
    const theme = activeThemeBtn ? activeThemeBtn.dataset.themeValue : "system";

    await browser.storage.local.set({
      geminiApiKey: apiKey,
      deepseekApiKey: deepseekApiKey,
      openRouterApiKey: openRouterApiKey,
      geminiModel: model,
      compressorModel: compModel,
      sidebarTheme: theme,
    });

    applyTheme(theme);

    // Also update the background script's model
    await browser.runtime.sendMessage({
      type: "SET_MODEL",
      model: model,
    }).catch(() => {});

    saveStatus.classList.remove("hidden");
    setTimeout(() => saveStatus.classList.add("hidden"), 2000);
  }

  // ===== Context =====
  async function updateContextBar() {
    try {
      const response = await browser.runtime.sendMessage({ type: "GET_CONTEXT" });
      if (response?.pageContext?.meta?.title) {
        contextText.textContent = response.pageContext.meta.title;
        contextBar.title = response.pageContext.meta.url || "";
        
        if (inspectContextBtn) inspectContextBtn.classList.remove("hidden");

        if (response.pageContext.isCompressed) {
          compressContextBtn.classList.add("hidden");
          contextText.textContent += " (Compressed ⚡)";
        } else if (response.pageContext.isTruncated) {
          compressContextBtn.classList.remove("hidden");
        } else {
          compressContextBtn.classList.add("hidden");
        }
      } else {
        contextText.textContent = "No page loaded";
        if (compressContextBtn) compressContextBtn.classList.add("hidden");
        if (inspectContextBtn) inspectContextBtn.classList.add("hidden");
      }
    } catch (e) {
      contextText.textContent = "No page loaded";
      if (compressContextBtn) compressContextBtn.classList.add("hidden");
      if (inspectContextBtn) inspectContextBtn.classList.add("hidden");
    }
  }

  function updateSelectionBanner(text) {
    if (text && text.length > 0) {
      currentSelection = text;
      const preview = text.length > 60 ? text.substring(0, 60) + "…" : text;
      selectionText.textContent = `"${preview}"`;
      selectionBanner.classList.remove("hidden");
    } else {
      currentSelection = "";
      selectionBanner.classList.add("hidden");
    }
  }

  // ===== Messages =====
  function addUserMessage(text, id = null) {
    // Remove welcome message
    const welcome = messagesArea.querySelector(".welcome-message");
    if (welcome) welcome.remove();

    const msgId = id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const div = document.createElement("div");
    div.className = "message message-user";
    div.dataset.id = msgId;
    div.innerHTML = `
      <div class="message-content">${escapeHtml(text)}</div>
      <div class="message-actions">
        <button class="msg-action-btn edit-msg-btn" title="Edit message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
      </div>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
    return msgId;
  }

  function addAiMessage(id = null) {
    const msgId = id || Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const div = document.createElement("div");
    div.className = "message message-ai";
    div.dataset.id = msgId;
    div.innerHTML = `
      <span class="message-label">Zen AI</span>
      <div class="message-content">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="message-actions hidden">
        <button class="msg-action-btn copy-msg-btn" title="Copy response">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button class="msg-action-btn regen-msg-btn" title="Regenerate response">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
      </div>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
    return { contentEl: div.querySelector(".message-content"), msgId: msgId, container: div };
  }

  function addErrorMessage(text) {
    const div = document.createElement("div");
    div.className = "message message-ai message-error";
    div.innerHTML = `
      <span class="message-label">Error</span>
      <div class="message-content">${escapeHtml(text)}</div>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    });
  }

  // ===== Markdown Rendering =====
  function renderMarkdown(text) {
    if (!text) return "";

    let html = escapeHtml(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Headers
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

    // Unordered lists
    html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

    // Links
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    // Paragraphs — wrap remaining text blocks
    html = html
      .split("\n\n")
      .map((block) => {
        block = block.trim();
        if (!block) return "";
        if (
          block.startsWith("<h") ||
          block.startsWith("<pre") ||
          block.startsWith("<ul") ||
          block.startsWith("<ol") ||
          block.startsWith("<blockquote")
        ) {
          return block;
        }
        return `<p>${block.replace(/\n/g, "<br>")}</p>`;
      })
      .join("");

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Chat Logic =====
  async function sendMessage(text, action = null) {
    if (isStreaming) return;
    if (!text && !action) return;

    isStreaming = true;
    const requestId = ++currentRequestId;

    // Display user message (for typed messages)
    let userMsgId = null;
    let originalText = text;
    
    if (text && !action) {
      userMsgId = addUserMessage(text);
      conversationHistory.push({ role: "user", text: text, id: userMsgId });
    } else if (action) {
      const actionLabels = {
        summarize: "📄 Summarize this page",
        explain: currentSelection
          ? `💡 Explain: "${currentSelection.substring(0, 50)}${currentSelection.length > 50 ? "…" : ""}"`
          : "💡 Explain this page",
        keypoints: "📋 Extract key points",
      };
      originalText = actionLabels[action] || action;
      userMsgId = addUserMessage(originalText);
      conversationHistory.push({ role: "user", text: originalText, id: userMsgId });
    }

    // Create AI response container
    const { contentEl: aiContent, msgId: aiMsgId, container: aiContainer } = addAiMessage();
    let fullResponse = "";

    // Clear input
    chatInput.value = "";
    chatInput.style.height = "auto";
    updateSendButton();

    // Send to background script
    browser.runtime.sendMessage({
      type: "CHAT_REQUEST",
      requestId,
      userMessage: text || "",
      action: action,
      conversationHistory: conversationHistory.slice(-100), // Keep last 100 messages
    });

    // Listen for streamed response
    function responseHandler(msg) {
      if (msg.type !== "CHAT_RESPONSE" || msg.requestId !== requestId) return;

      if (msg.error) {
        aiContent.closest(".message").classList.add("message-error");
        if (msg.error === "NO_API_KEY") {
          aiContent.innerHTML =
            'No API key set. Click the <strong>⚙ settings</strong> icon to add your Gemini API key.';
        } else {
          aiContent.innerHTML = renderMarkdown(msg.message || "An error occurred.");
        }
        isStreaming = false;
        browser.runtime.onMessage.removeListener(responseHandler);
        return;
      }

      if (msg.chunk) {
        // Remove typing indicator on first chunk
        const typingIndicator = aiContent.querySelector(".typing-indicator");
        if (typingIndicator) typingIndicator.remove();

        fullResponse += msg.chunk;
        aiContent.innerHTML = renderMarkdown(fullResponse);
        scrollToBottom();
      }

      if (msg.done) {
        isStreaming = false;
        conversationHistory.push({ role: "model", text: fullResponse, id: aiMsgId });
        aiContainer.querySelector('.message-actions').classList.remove('hidden');
        browser.runtime.onMessage.removeListener(responseHandler);
      }
    }

    browser.runtime.onMessage.addListener(responseHandler);
  }

  // ===== Event Listeners =====
  function setupEventListeners() {
    // Send button
    sendBtn.addEventListener("click", () => {
      const text = chatInput.value.trim();
      if (text) sendMessage(text);
    });

    // Enter to send (Shift+Enter for newline)
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) sendMessage(text);
      }
    });

    // Auto-resize textarea
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
      updateSendButton();
    });

    // Quick action buttons
    quickActions.addEventListener("click", (e) => {
      const btn = e.target.closest(".action-btn");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action) sendMessage(null, action);
    });

    // Clear conversation / New Chat
    clearBtn.addEventListener("click", () => {
      conversationHistory = [];
      messagesArea.innerHTML = `
        <div class="welcome-message">
          <div class="welcome-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h2>Zen AI</h2>
          <p>Ask questions about the current page, summarize content, or get explanations for highlighted text.</p>
        </div>`;
    });

    // Settings
    settingsBtn.addEventListener("click", () => {
      settingsModal.classList.remove("hidden");
    });

    settingsClose.addEventListener("click", () => {
      settingsModal.classList.add("hidden");
    });

    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) settingsModal.classList.add("hidden");
    });

    saveSettingsBtn.addEventListener("click", saveSettings);

    // Toggle API key visibility
    toggleKeyVisibility.addEventListener("click", () => {
      apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
    });
    toggleDeepseekKeyVisibility.addEventListener("click", () => {
      deepseekApiKeyInput.type = deepseekApiKeyInput.type === "password" ? "text" : "password";
    });
    toggleOpenRouterKeyVisibility.addEventListener("click", () => {
      openRouterApiKeyInput.type = openRouterApiKeyInput.type === "password" ? "text" : "password";
    });

    // Theme toggle buttons
    document.querySelectorAll(".theme-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".theme-option").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyTheme(btn.dataset.themeValue);
      });
    });

    // Compress Context
    if (compressContextBtn) {
      compressContextBtn.addEventListener("click", async () => {
        compressContextBtn.disabled = true;
        const originalHtml = compressContextBtn.innerHTML;
        compressContextBtn.innerHTML = "⏳";
        
        try {
          const res = await browser.runtime.sendMessage({ type: "COMPRESS_PAGE_CONTEXT" });
          if (res && res.success) {
            updateContextBar();
          } else {
            console.warn("Compression failed", res?.error);
            compressContextBtn.innerHTML = "⚠️";
            setTimeout(() => { compressContextBtn.innerHTML = originalHtml; }, 2000);
          }
        } catch(e) {
           console.error("Error compressing", e);
           compressContextBtn.innerHTML = "❌";
           setTimeout(() => { compressContextBtn.innerHTML = originalHtml; }, 2000);
        } finally {
          compressContextBtn.disabled = false;
          if (compressContextBtn.innerHTML === "⏳") compressContextBtn.innerHTML = originalHtml;
        }
      });
    }

    // Inspect Context Debugging
    const contextDebugModal = document.getElementById("contextDebugModal");
    const contextDebugClose = document.getElementById("contextDebugClose");
    const contextViewArea = document.getElementById("contextViewArea");

    if (inspectContextBtn) {
      inspectContextBtn.addEventListener("click", async () => {
        try {
          const response = await browser.runtime.sendMessage({ type: "GET_CONTEXT" });
          if (response?.pageContext?.content) {
            contextViewArea.value = response.pageContext.content;
            contextDebugModal.classList.remove("hidden");
          } else {
            alert("No context data available.");
          }
        } catch(e) {
          alert("Error fetching context: " + e.message);
        }
      });
    }

    if (contextDebugClose) {
      contextDebugClose.addEventListener("click", () => {
        contextDebugModal.classList.add("hidden");
      });
    }

    if (contextDebugModal) {
      contextDebugModal.addEventListener("click", (e) => {
        if (e.target === contextDebugModal) contextDebugModal.classList.add("hidden");
      });
    }

    // Selection dismiss
    selectionDismiss.addEventListener("click", () => {
      updateSelectionBanner("");
    });

    // Listen for selection updates from content script
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === "SELECTION_UPDATE") {
        updateSelectionBanner(msg.selection);
      }
    });

    // Message Action Buttons (Edit, Copy, Regenerate)
    messagesArea.addEventListener("click", (e) => {
      const btn = e.target.closest(".msg-action-btn");
      if (!btn) return;
      
      const messageEl = btn.closest(".message");
      const msgId = messageEl.dataset.id;
      if (!msgId) return;

      if (btn.classList.contains("copy-msg-btn")) {
        // Copy logic
        const historyItem = conversationHistory.find(item => item.id === msgId);
        if (historyItem) {
          navigator.clipboard.writeText(historyItem.text).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            setTimeout(() => btn.innerHTML = originalHtml, 2000);
          });
        }
      } 
      else if (btn.classList.contains("edit-msg-btn")) {
        // Edit user message logic
        if (isStreaming) return;
        const msgIndex = conversationHistory.findIndex(item => item.id === msgId);
        if (msgIndex !== -1) {
          const historyItem = conversationHistory[msgIndex];
          chatInput.value = historyItem.text;
          chatInput.style.height = "auto";
          chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + "px";
          updateSendButton();
          
          // Delete this message and all subsequent from DOM
          let currentEl = messageEl;
          while (currentEl) {
            const nextEl = currentEl.nextElementSibling;
            currentEl.remove();
            currentEl = nextEl;
          }
          
          // Truncate history
          conversationHistory = conversationHistory.slice(0, msgIndex);
        }
      }
      else if (btn.classList.contains("regen-msg-btn")) {
        // Regenerate AI response logic
        if (isStreaming) return;
        const msgIndex = conversationHistory.findIndex(item => item.id === msgId);
        if (msgIndex !== -1) {
          // Find the last user message before this AI message
          let lastUserMessageText = "";
          for (let i = msgIndex - 1; i >= 0; i--) {
            if (conversationHistory[i].role === "user") {
              lastUserMessageText = conversationHistory[i].text;
              break;
            }
          }
          
          if (lastUserMessageText) {
            // Delete this AI message and all subsequent from DOM
            let currentEl = messageEl;
            while (currentEl) {
              const nextEl = currentEl.nextElementSibling;
              currentEl.remove();
              currentEl = nextEl;
            }
            // Truncate history
            conversationHistory = conversationHistory.slice(0, msgIndex);
            
            // Re-trigger send message silently (without creating a new user bubble)
            // But we actually *want* to just trigger the AI generation
            // The simplest way to perfectly maintain state is to pop the history and re-send.
            // Since `sendMessage` adds a user bubble, we can bypass that by passing it directly to the background,
            // OR we can just edit the DOM to show the loading bubble and call background script directly.
            
            isStreaming = true;
            const requestId = ++currentRequestId;
            const { contentEl: aiContent, msgId: newAiMsgId, container: aiContainer } = addAiMessage();
            
            browser.runtime.sendMessage({
              type: "CHAT_REQUEST",
              requestId,
              userMessage: lastUserMessageText,
              action: null,
              conversationHistory: conversationHistory.slice(-100),
            });
            
            // Re-use logic for streamed response
            let fullResponse = "";
            const responseHandler = (msg) => {
              if (msg.type !== "CHAT_RESPONSE" || msg.requestId !== requestId) return;
              if (msg.error) {
                aiContent.closest(".message").classList.add("message-error");
                aiContent.innerHTML = renderMarkdown(msg.message || "An error occurred.");
                isStreaming = false;
                browser.runtime.onMessage.removeListener(responseHandler);
                return;
              }
              if (msg.chunk) {
                const typingIndicator = aiContent.querySelector(".typing-indicator");
                if (typingIndicator) typingIndicator.remove();
                fullResponse += msg.chunk;
                aiContent.innerHTML = renderMarkdown(fullResponse);
                scrollToBottom();
              }
              if (msg.done) {
                isStreaming = false;
                conversationHistory.push({ role: "model", text: fullResponse, id: newAiMsgId });
                aiContainer.querySelector('.message-actions').classList.remove('hidden');
                browser.runtime.onMessage.removeListener(responseHandler);
              }
            };
            browser.runtime.onMessage.addListener(responseHandler);
          }
        }
      }
    });

    // Update context when sidebar becomes visible
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        updateContextBar();
      }
    });

    // Periodic context update (every 5 seconds when visible)
    setInterval(() => {
      if (!document.hidden) {
        updateContextBar();
      }
    }, 5000);
  }

  function updateSendButton() {
    sendBtn.disabled = chatInput.value.trim().length === 0;
  }

  // ===== Start =====
  init();
})();
