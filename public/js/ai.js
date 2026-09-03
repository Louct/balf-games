(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var convos = [];
  var attachments = [];
  var imageAttachments = [];
  var chatModels = [];
  var imageModels = [];
  var defaultModel = "gpt-5-6-sol";
  var defaultImgModel = "gpt-image-2";
  var busying = false;
  var maxAttachments = 3;
  var maxImageAttachments = 4;
  var maxFileBytes = 4 * 1024 * 1024;

  var app = $("ai-app");
  var msgsEl = $("ai-msgs");
  var chatInp = $("ai-inp");
  var chatSend = $("ai-send");
  var modelEl = $("ai-model");
  var modelTrigger = $("ai-model-trigger");
  var modelMenu = $("ai-model-menu");
  var modelSearch = $("ai-model-search");
  var modelList = $("ai-model-list");
  var imgModelEl = $("ai-img-model");
  var imgModelTrigger = $("ai-img-model-trigger");
  var imgModelMenu = $("ai-img-model-menu");
  var imgModelList = $("ai-img-model-list");
  var imgForm = $("ai-img-form");
  var imgPrompt = $("ai-img-prompt");
  var imgSend = $("ai-img-send");
  var imgGrid = $("ai-img-grid");
  var imgEmpty = $("ai-img-empty");
  var attachButton = $("ai-attach");
  var fileInput = $("ai-file-input");
  var attachmentsEl = $("ai-attachments");
  var imgAttachButton = $("ai-img-attach");
  var imgFileInput = $("ai-img-file-input");
  var imgAttachmentsEl = $("ai-img-attachments");
  var errEl = $("ai-err");
  var errImgEl = $("ai-err-img");

  var providers = [
    { name: "OpenAI", mark: "O", pattern: /^(gpt|chatgpt|o[134](?:-|$)|dall-e|text-)/i },
    { name: "Anthropic", mark: "A", pattern: /claude|fable(?:-|\s*)5/i },
    { name: "Google", mark: "G", pattern: /gemini|gemma/i },
    { name: "Qwen", mark: "Q", pattern: /qwen/i },
    { name: "Meta", mark: "M", pattern: /llama|meta-/i },
    { name: "DeepSeek", mark: "D", pattern: /deepseek/i },
    { name: "Mistral", mark: "M", pattern: /mistral|mixtral|codestral/i },
    { name: "xAI", mark: "X", pattern: /grok/i },
    { name: "Moonshot", mark: "K", pattern: /kimi|moonshot/i },
    { name: "Cohere", mark: "C", pattern: /cohere|command-r/i },
    { name: "Microsoft", mark: "μ", pattern: /phi-|copilot/i },
    { name: "Amazon", mark: "a", pattern: /nova|titan/i },
    { name: "Black Forest", mark: "B", pattern: /flux/i },
    { name: "Stability AI", mark: "S", pattern: /stable|sdxl|sd3(?:-|$)/i },
    { name: "Ideogram", mark: "I", pattern: /ideogram/i },
    { name: "Recraft", mark: "R", pattern: /recraft/i },
    { name: "Krea", mark: "K", pattern: /krea/i },
  ];

  function providerFor(id, ownedBy) {
    var source = String(id || "") + " " + String(ownedBy || "");
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].pattern.test(source)) return providers[i];
    }
    return { name: "Other", mark: "✦" };
  }

  function normalizeModels(list) {
    return list.map(function (item) {
      var id = String((item && item.id) || item || "");
      var provider = providerFor(id, item && (item.owned_by || item.provider));
      return { id: id, provider: provider.name, mark: provider.mark };
    }).filter(function (item) { return item.id; }).sort(function (a, b) {
      var providerOrderA = providers.findIndex(function (p) { return p.name === a.provider; });
      var providerOrderB = providers.findIndex(function (p) { return p.name === b.provider; });
      if (providerOrderA < 0) providerOrderA = providers.length;
      if (providerOrderB < 0) providerOrderB = providers.length;
      if (providerOrderA !== providerOrderB) return providerOrderA - providerOrderB;
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  function isImageModel(id) {
    return /image|img|dall|flux|sdxl|sd3(?:-|$)|banana|krea|recraft|ideogram|mai-image/i.test(id);
  }

  function makeProviderIcon(model) {
    var icon = document.createElement("span");
    icon.className = "ai-provider-icon";
    icon.setAttribute("data-provider", model.provider);
    icon.textContent = model.mark;
    return icon;
  }

  function makeModelCopy(model) {
    var copy = document.createElement("span");
    copy.className = "ai-model-option-copy";
    var name = document.createElement("strong");
    name.textContent = model.id;
    var brand = document.createElement("small");
    brand.textContent = model.provider;
    copy.appendChild(name);
    copy.appendChild(brand);
    return copy;
  }

  function findModel(models, id) {
    return models.find(function (model) { return model.id === id; }) || models[0];
  }

  function updateTrigger(trigger, model) {
    if (!model) return;
    var oldIcon = trigger.querySelector(".ai-provider-icon");
    oldIcon.textContent = model.mark;
    oldIcon.setAttribute("data-provider", model.provider);
    trigger.querySelector("strong").textContent = model.id;
    trigger.querySelector("small").textContent = model.provider;
    trigger.title = model.id + " · " + model.provider;
  }

  function buildNativeSelect(select, models, selected) {
    select.innerHTML = "";
    var groups = {};
    models.forEach(function (model) {
      if (!groups[model.provider]) groups[model.provider] = [];
      groups[model.provider].push(model);
    });
    Object.keys(groups).forEach(function (provider) {
      var group = document.createElement("optgroup");
      group.label = provider;
      groups[provider].forEach(function (model) {
        var option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.id;
        option.selected = model.id === selected;
        group.appendChild(option);
      });
      select.appendChild(group);
    });
  }

  function renderModelList(kind, query) {
    var isChat = kind === "chat";
    var models = isChat ? chatModels : imageModels;
    var selected = isChat ? modelEl.value : imgModelEl.value;
    var container = isChat ? modelList : imgModelList;
    var search = String(query || "").trim().toLowerCase();
    var filtered = models.filter(function (model) {
      return !search || model.id.toLowerCase().indexOf(search) >= 0 || model.provider.toLowerCase().indexOf(search) >= 0;
    });
    container.innerHTML = "";

    if (!filtered.length) {
      var empty = document.createElement("div");
      empty.className = "ai-model-empty";
      empty.textContent = "No models match that search.";
      container.appendChild(empty);
      return;
    }

    var currentProvider = "";
    filtered.forEach(function (model) {
      if (model.provider !== currentProvider) {
        currentProvider = model.provider;
        var heading = document.createElement("div");
        heading.className = "ai-model-group-title";
        heading.textContent = currentProvider;
        container.appendChild(heading);
      }
      var option = document.createElement("button");
      option.type = "button";
      option.className = "ai-model-option" + (model.id === selected ? " selected" : "");
      option.setAttribute("data-model-value", model.id);
      option.setAttribute("data-model-kind", kind);
      option.appendChild(makeProviderIcon(model));
      option.appendChild(makeModelCopy(model));
      var check = document.createElement("span");
      check.className = "ai-model-check";
      check.textContent = model.id === selected ? "✓" : "";
      option.appendChild(check);
      container.appendChild(option);
    });
  }

  function closeModelMenus() {
    modelMenu.hidden = true;
    imgModelMenu.hidden = true;
    modelTrigger.setAttribute("aria-expanded", "false");
    imgModelTrigger.setAttribute("aria-expanded", "false");
  }

  function openModelMenu(kind) {
    var isChat = kind === "chat";
    var menu = isChat ? modelMenu : imgModelMenu;
    var trigger = isChat ? modelTrigger : imgModelTrigger;
    var wasOpen = !menu.hidden;
    closeModelMenus();
    if (wasOpen) return;
    renderModelList(kind, isChat ? modelSearch.value : "");
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (isChat) modelSearch.focus();
  }

  function selectModel(kind, id) {
    var isChat = kind === "chat";
    var models = isChat ? chatModels : imageModels;
    var select = isChat ? modelEl : imgModelEl;
    var trigger = isChat ? modelTrigger : imgModelTrigger;
    var model = findModel(models, id);
    if (!model) return;
    select.value = model.id;
    updateTrigger(trigger, model);
    closeModelMenus();
  }

  function applyModels(list) {
    var normalized = normalizeModels(list);
    chatModels = normalized.filter(function (model) { return !isImageModel(model.id) && !/video/i.test(model.id); });
    imageModels = normalized.filter(function (model) { return isImageModel(model.id) && !/video/i.test(model.id); });
    if (!chatModels.length) chatModels = normalizeModels([{ id: defaultModel }]);
    if (!imageModels.length) imageModels = normalizeModels([{ id: defaultImgModel }]);

    var selectedChat = findModel(chatModels, defaultModel) || chatModels[0];
    var selectedImage = findModel(imageModels, defaultImgModel) || imageModels[0];
    buildNativeSelect(modelEl, chatModels, selectedChat.id);
    buildNativeSelect(imgModelEl, imageModels, selectedImage.id);
    updateTrigger(modelTrigger, selectedChat);
    updateTrigger(imgModelTrigger, selectedImage);
    renderModelList("chat", "");
    renderModelList("image", "");
  }

  function loadModels() {
    applyModels([{ id: defaultModel }, { id: defaultImgModel }]);
    fetch("/api/ai/models")
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || !data.ok) throw new Error("bad models response");
        applyModels(data.data || []);
      })
      .catch(function () {});
  }

  function addMsg(role, text, images) {
    var wrap = document.createElement("div");
    wrap.className = "ai-msg " + (role === "user" ? "user" : "assistant");
    var head = document.createElement("div");
    head.className = "ai-msg-head";
    head.textContent = role === "user" ? "you" : "aetheris ai";
    var bubble = document.createElement("div");
    bubble.className = "ai-bubble";
    bubble.textContent = text || "";
    if (images && images.length) {
      var media = document.createElement("div");
      media.className = "ai-message-images";
      images.forEach(function (image) {
        var img = document.createElement("img");
        img.src = image.dataUrl;
        img.alt = image.name;
        media.appendChild(img);
      });
      bubble.appendChild(media);
    }
    wrap.appendChild(head);
    wrap.appendChild(bubble);
    msgsEl.appendChild(wrap);
    scrollBottom();
    return bubble;
  }

  function addTyping() {
    var wrap = document.createElement("div");
    wrap.className = "ai-msg assistant";
    wrap.id = "ai-typing";
    wrap.innerHTML = '<div class="ai-msg-head">aetheris ai</div><div class="ai-typing"><span></span><span></span><span></span></div>';
    msgsEl.appendChild(wrap);
    scrollBottom();
    return wrap;
  }

  function scrollBottom() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function setErr(msg, target) {
    if (!target || target === "chat") errEl.textContent = msg || "";
    if (!target || target === "image") errImgEl.textContent = msg || "";
  }

  function syncActionButtons() {
    var chatReady = Boolean(chatInp.value.trim() || attachments.length);
    var imageReady = Boolean(imgPrompt.value.trim());
    chatSend.disabled = busying || !chatReady;
    imgSend.disabled = busying || !imageReady;
    chatSend.classList.toggle("is-ready", chatReady && !busying);
    imgSend.classList.toggle("is-ready", imageReady && !busying);
  }

  function setBusy(busy) {
    busying = busy;
    chatInp.disabled = busy;
    modelEl.disabled = busy;
    modelTrigger.disabled = busy;
    attachButton.disabled = busy;
    imgAttachButton.disabled = busy;
    imgModelEl.disabled = busy;
    imgModelTrigger.disabled = busy;
    imgPrompt.disabled = busy;
    syncActionButtons();
    if (busy) closeModelMenus();
  }

  function renderAttachments() {
    attachmentsEl.innerHTML = "";
    attachmentsEl.classList.toggle("has-items", attachments.length > 0);
    attachments.forEach(function (attachment, index) {
      var item = document.createElement("div");
      item.className = "ai-attachment";
      var img = document.createElement("img");
      img.src = attachment.dataUrl;
      img.alt = "";
      var copy = document.createElement("span");
      copy.className = "ai-attachment-copy";
      var name = document.createElement("strong");
      name.textContent = attachment.name;
      var size = document.createElement("small");
      size.textContent = (attachment.size / 1024 / 1024).toFixed(1) + " MB";
      copy.appendChild(name);
      copy.appendChild(size);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ai-attachment-remove";
      remove.setAttribute("data-remove-attachment", String(index));
      remove.setAttribute("aria-label", "Remove " + attachment.name);
      remove.textContent = "×";
      item.appendChild(img);
      item.appendChild(copy);
      item.appendChild(remove);
      attachmentsEl.appendChild(item);
    });
    syncActionButtons();
  }

  function renderImageAttachments() {
    imgAttachmentsEl.innerHTML = "";
    imgAttachmentsEl.classList.toggle("has-items", imageAttachments.length > 0);
    imageAttachments.forEach(function (attachment, index) {
      var item = document.createElement("div");
      item.className = "ai-attachment";
      var img = document.createElement("img");
      img.src = attachment.dataUrl;
      img.alt = "Reference " + (index + 1);
      var copy = document.createElement("span");
      copy.className = "ai-attachment-copy";
      var name = document.createElement("strong");
      name.textContent = attachment.name;
      var size = document.createElement("small");
      size.textContent = "Reference " + (index + 1) + " · " + (attachment.size / 1024 / 1024).toFixed(1) + " MB";
      copy.appendChild(name);
      copy.appendChild(size);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ai-attachment-remove";
      remove.setAttribute("data-remove-image-attachment", String(index));
      remove.setAttribute("aria-label", "Remove " + attachment.name);
      remove.textContent = "×";
      item.appendChild(img);
      item.appendChild(copy);
      item.appendChild(remove);
      imgAttachmentsEl.appendChild(item);
    });
    syncActionButtons();
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve({ name: file.name, size: file.size, type: file.type, dataUrl: reader.result });
      };
      reader.onerror = function () { reject(new Error("Could not read " + file.name + ".")); };
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(files) {
    var incoming = Array.prototype.slice.call(files || []);
    var room = maxAttachments - attachments.length;
    if (!room) {
      setErr("You can attach up to three images per message.", "chat");
      return;
    }
    incoming = incoming.slice(0, room);
    for (var i = 0; i < incoming.length; i++) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(incoming[i].type)) {
        setErr("Use a PNG, JPG, WebP or GIF image.", "chat");
        return;
      }
      if (incoming[i].size > maxFileBytes) {
        setErr(incoming[i].name + " is larger than 4 MB.", "chat");
        return;
      }
    }
    try {
      var loaded = await Promise.all(incoming.map(readFile));
      attachments = attachments.concat(loaded);
      setErr("", "chat");
      renderAttachments();
    } catch (error) {
      setErr(error.message || "Could not attach that image.", "chat");
    } finally {
      fileInput.value = "";
    }
  }

  async function addImageReferenceFiles(files) {
    var incoming = Array.prototype.slice.call(files || []);
    var room = maxImageAttachments - imageAttachments.length;
    if (!room) {
      setErr("You can add up to four reference images.", "image");
      return;
    }
    if (incoming.length > room) {
      setErr("Only the first " + room + " image" + (room === 1 ? "" : "s") + " were added.", "image");
    }
    incoming = incoming.slice(0, room);
    for (var i = 0; i < incoming.length; i++) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(incoming[i].type)) {
        setErr("Use a PNG, JPG, WebP or GIF reference image.", "image");
        imgFileInput.value = "";
        return;
      }
      if (incoming[i].size > maxFileBytes) {
        setErr(incoming[i].name + " is larger than 4 MB.", "image");
        imgFileInput.value = "";
        return;
      }
    }
    try {
      var loaded = await Promise.all(incoming.map(readFile));
      imageAttachments = imageAttachments.concat(loaded);
      setErr("", "image");
      renderImageAttachments();
    } catch (error) {
      setErr(error.message || "Could not add that reference image.", "image");
    } finally {
      imgFileInput.value = "";
    }
  }

  async function sendChat() {
    var text = chatInp.value.trim();
    if ((!text && !attachments.length) || busying) return;
    var pendingAttachments = attachments.slice();
    var messageContent = text;
    if (pendingAttachments.length) {
      messageContent = [];
      if (text) messageContent.push({ type: "text", text: text });
      pendingAttachments.forEach(function (attachment) {
        messageContent.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
      });
    }

    chatInp.value = "";
    attachments = [];
    resizeInput(chatInp);
    renderAttachments();
    setErr("", "chat");

    convos.push({ role: "user", content: messageContent });
    addMsg("user", text || (pendingAttachments.length === 1 ? "Attached an image" : "Attached " + pendingAttachments.length + " images"), pendingAttachments);
    setBusy(true);
    var typing = addTyping();
    var model = modelEl.value || defaultModel;

    try {
      var response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model, messages: convos, stream: true }),
      });
      if (!response.ok) {
        var errorData = await response.json().catch(function () { return {}; });
        throw new Error(errorData.error || "Request failed (" + response.status + ").");
      }

      var answer = "";
      var bubble = null;
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      for (;;) {
        var result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.indexOf("data:") !== 0) continue;
          var data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          var json;
          try { json = JSON.parse(data); } catch (_error) { continue; }
          var delta = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || "";
          if (!delta) continue;
          if (!bubble) {
            if (typing.parentNode) typing.parentNode.removeChild(typing);
            bubble = addMsg("assistant", "");
          }
          answer += delta;
          bubble.textContent = answer;
          scrollBottom();
        }
      }
      if (!bubble) {
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        bubble = addMsg("assistant", answer || "No response returned.");
      }
      convos.push({ role: "assistant", content: answer });
    } catch (error) {
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      convos.pop();
      attachments = pendingAttachments;
      renderAttachments();
      setErr(error && error.message ? error.message : "Something went wrong. Try again.", "chat");
    } finally {
      setBusy(false);
    }
  }

  function clearChat() {
    convos = [];
    attachments = [];
    renderAttachments();
    msgsEl.innerHTML =
      '<div class="ai-empty">' +
      '<span class="ai-eyebrow">A blank page, ready</span>' +
      '<h1>What are we<br>making today?</h1>' +
      '<p>Think through an idea, analyze an image, or get a direct answer. Start anywhere.</p>' +
      '<div class="ai-prompt-grid">' +
      '<button type="button" data-chat-prompt="Help me turn a rough idea into a clear plan"><span>01</span><strong>Shape an idea</strong><small>Turn a thought into a clear plan</small></button>' +
      '<button type="button" data-chat-prompt="Help me understand what is happening in this image"><span>02</span><strong>Analyze an image</strong><small>Attach a photo or screenshot</small></button>' +
      '<button type="button" data-chat-prompt="Explain a difficult topic in plain language"><span>03</span><strong>Learn something</strong><small>Make a hard topic feel simple</small></button>' +
      '</div></div>';
    setErr("");
    chatInp.value = "";
    resizeInput(chatInp);
    syncActionButtons();
  }

  async function genImages() {
    var prompt = imgPrompt.value.trim();
    if (!prompt || busying) return;
    var selectedImageModel = imgModelEl.value || defaultImgModel;
    setErr("", "image");
    setBusy(true);
    app.classList.add("loading-img");
    imgEmpty.style.display = "none";
    try {
      var response = await fetch("/api/ai/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt,
          model: selectedImageModel,
          images: imageAttachments.map(function (attachment) { return attachment.dataUrl; }),
        }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Image request failed (" + response.status + ").");
      var images = data.data || [];
      if (!images.length) throw new Error("No images returned.");
      imgGrid.innerHTML = "";
      images.forEach(function (image) {
        var card = document.createElement("div");
        card.className = "ai-img-card";
        var element = document.createElement("img");
        element.src = image.b64_json ? "data:" + (image.mime_type || "image/png") + ";base64," + image.b64_json : image.url;
        element.alt = prompt;
        element.referrerPolicy = "no-referrer";
        var caption = document.createElement("div");
        caption.className = "cap";
        caption.textContent = prompt;
        card.appendChild(element);
        card.appendChild(caption);
        imgGrid.appendChild(card);
      });
    } catch (error) {
      setErr(error && error.message ? error.message : "Image generation failed.", "image");
    } finally {
      setBusy(false);
      app.classList.remove("loading-img");
    }
  }

  function setMode(mode) {
    closeModelMenus();
    app.classList.toggle("mode-chat", mode === "chat");
    app.classList.toggle("mode-img", mode === "img");
    $("ai-section-kicker").textContent = mode === "chat" ? "Conversation" : "Create";
    $("ai-section-title").textContent = mode === "chat" ? "New thread" : "Image studio";
    var tabs = document.querySelectorAll(".ai-tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("active", tabs[i].getAttribute("data-mode") === mode);
    }
  }

  function resizeInput(element) {
    element.style.height = "auto";
    element.style.height = Math.min(element.scrollHeight, 140) + "px";
  }

  modelTrigger.addEventListener("click", function () { openModelMenu("chat"); });
  imgModelTrigger.addEventListener("click", function () { openModelMenu("image"); });
  modelSearch.addEventListener("input", function () { renderModelList("chat", modelSearch.value); });
  modelList.addEventListener("click", function (event) {
    var option = event.target.closest("[data-model-value]");
    if (option) selectModel("chat", option.getAttribute("data-model-value"));
  });
  imgModelList.addEventListener("click", function (event) {
    var option = event.target.closest("[data-model-value]");
    if (option) selectModel("image", option.getAttribute("data-model-value"));
  });
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".ai-model-picker")) closeModelMenus();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeModelMenus();
  });

  attachButton.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () { addFiles(fileInput.files); });
  attachmentsEl.addEventListener("click", function (event) {
    var remove = event.target.closest("[data-remove-attachment]");
    if (!remove) return;
    attachments.splice(Number(remove.getAttribute("data-remove-attachment")), 1);
    renderAttachments();
  });
  imgAttachButton.addEventListener("click", function () { imgFileInput.click(); });
  imgFileInput.addEventListener("change", function () { addImageReferenceFiles(imgFileInput.files); });
  imgAttachmentsEl.addEventListener("click", function (event) {
    var remove = event.target.closest("[data-remove-image-attachment]");
    if (!remove) return;
    imageAttachments.splice(Number(remove.getAttribute("data-remove-image-attachment")), 1);
    renderImageAttachments();
  });

  chatSend.addEventListener("click", sendChat);
  chatInp.addEventListener("input", function () {
    resizeInput(chatInp);
    syncActionButtons();
  });
  chatInp.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });
  $("ai-clear").addEventListener("click", clearChat);
  $("ai-clear-mobile").addEventListener("click", clearChat);
  msgsEl.addEventListener("click", function (event) {
    var starter = event.target.closest("[data-chat-prompt]");
    if (!starter) return;
    chatInp.value = starter.getAttribute("data-chat-prompt");
    resizeInput(chatInp);
    syncActionButtons();
    chatInp.focus();
  });

  document.querySelector(".ai-image-starters").addEventListener("click", function (event) {
    var starter = event.target.closest("[data-image-prompt]");
    if (!starter) return;
    imgPrompt.value = starter.getAttribute("data-image-prompt");
    resizeInput(imgPrompt);
    syncActionButtons();
    imgPrompt.focus();
  });
  imgForm.addEventListener("submit", function (event) {
    event.preventDefault();
    genImages();
  });
  imgPrompt.addEventListener("input", function () {
    resizeInput(imgPrompt);
    syncActionButtons();
  });
  imgPrompt.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      genImages();
    }
  });
  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      clearChat();
      setMode("chat");
      chatInp.focus();
    }
  });

  var tabs = document.querySelectorAll(".ai-tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function () { setMode(this.getAttribute("data-mode")); });
  }

  clearChat();
  renderImageAttachments();
  syncActionButtons();
  loadModels();
  setMode("chat");
})();
