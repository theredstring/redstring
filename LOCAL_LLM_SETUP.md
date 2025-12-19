# Local LLM Setup Guide

This guide explains how to configure and use local Large Language Models (LLMs) with Redstring's Wizard agent. Running models locally provides privacy, offline capability, zero API costs, and lower latency.

## Overview

Redstring supports any OpenAI-compatible local LLM server, including:
- **Ollama** - Easy-to-use local LLM runtime
- **LM Studio** - User-friendly desktop app for running models
- **LocalAI** - Self-hosted AI inference server
- **vLLM** - High-performance inference engine
- **Custom servers** - Any OpenAI-compatible endpoint

All local providers use the same OpenAI `/v1/chat/completions` API format, making them compatible with Redstring's Wizard agent.

## Quick Start: Ollama

### Installation

**macOS:**
```bash
brew install ollama
```

**Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:**
Download installer from [ollama.com](https://ollama.com)

### Starting the Server

```bash
ollama serve
```

The server will start on `http://localhost:11434` by default.

### Pulling Models

```bash
# Popular models
ollama pull llama2
ollama pull llama3
ollama pull mistral
ollama pull codellama
ollama pull phi
ollama pull gemma
```

### Configuring in Redstring

1. Open Redstring → AI Panel → Click the 🔑 icon
2. Select "💻 Local LLM Server" from the provider dropdown
3. Click the "Ollama" preset button
4. Verify endpoint: `http://localhost:11434/v1/chat/completions`
5. Enter model name (e.g., `llama2`)
6. Click "Test Connection" to verify
7. Click "Save Configuration"

## Provider-Specific Setup

### Ollama

**Default Port:** 11434

**Common Models:**
- `llama2` - Meta's Llama 2 (7B, 13B, 70B variants)
- `llama3` - Meta's Llama 3 (8B, 70B variants)
- `mistral` - Mistral 7B
- `codellama` - Code-focused Llama variant
- `phi` - Microsoft Phi models
- `gemma` - Google Gemma models

**Setup Steps:**
1. Install Ollama from [ollama.com](https://ollama.com)
2. Run `ollama serve` in terminal
3. Pull desired model: `ollama pull <model-name>`
4. Configure in Redstring using Ollama preset

**Documentation:** [ollama.com](https://ollama.com)

### LM Studio

**Default Port:** 1234

**Setup Steps:**
1. Download LM Studio from [lmstudio.ai](https://lmstudio.ai)
2. Install and launch the application
3. Download a model through the LM Studio UI
4. Start the local server (Settings → Local Server → Start Server)
5. Configure in Redstring:
   - Endpoint: `http://localhost:1234/v1/chat/completions`
   - Model: Use the model name from LM Studio

**Documentation:** [lmstudio.ai](https://lmstudio.ai)

### LocalAI

**Default Port:** 8080

**Setup Steps:**
1. Install LocalAI via Docker:
   ```bash
   docker run -p 8080:8080 -ti localai/localai:latest
   ```
2. Or download binary from [localai.io](https://localai.io)
3. Configure in Redstring:
   - Endpoint: `http://localhost:8080/v1/chat/completions`
   - Model: `gpt-3.5-turbo` or model name configured in LocalAI

**Documentation:** [localai.io](https://localai.io)

### vLLM

**Default Port:** 8000

**Setup Steps:**
1. Install vLLM:
   ```bash
   pip install vllm
   ```
2. Start server:
   ```bash
   python -m vllm.entrypoints.openai.api_server --model <model-name>
   ```
3. Configure in Redstring:
   - Endpoint: `http://localhost:8000/v1/chat/completions`
   - Model: Use the model name you started vLLM with

**Documentation:** [docs.vllm.ai](https://docs.vllm.ai)

### Custom OpenAI-Compatible Server

If you have a custom server that implements the OpenAI API format:

1. Ensure your server exposes `/v1/chat/completions` endpoint
2. Configure in Redstring:
   - Endpoint: `http://localhost:<port>/v1/chat/completions`
   - Model: Model name as recognized by your server
   - API Key: Only if your server requires authentication

## Configuration in Redstring

### Using Presets

1. Open AI Panel → Click 🔑 icon
2. Select "💻 Local LLM Server"
3. Click a preset button (Ollama, LM Studio, etc.)
4. Endpoint and model suggestions will auto-fill
5. Adjust if needed, then test connection
6. Save configuration

### Manual Configuration

1. Select "💻 Local LLM Server" from provider dropdown
2. Enter endpoint URL manually (e.g., `http://localhost:11434/v1/chat/completions`)
3. Enter model name
4. Click "Test Connection" to verify
5. Save configuration

### Connection Testing

The "Test Connection" button will:
- Check if the server is running
- Verify the endpoint is accessible
- List available models (if supported)
- Show clear error messages if connection fails

## Model Recommendations

### For Graph Generation Tasks

**Recommended Models:**
- **llama3:8b** - Good balance of quality and speed
- **mistral** - Fast and capable
- **llama2:13b** - Better quality, slower

**Minimum Requirements:**
- 8GB RAM for 7B models
- 16GB RAM for 13B models
- 32GB+ RAM for 70B models

### Performance Tips

1. **Use smaller models** for faster responses (7B-8B parameters)
2. **Close other applications** to free up RAM
3. **Use GPU acceleration** if available (CUDA, Metal, etc.)
4. **Monitor system resources** - local models can be CPU/RAM intensive

## Troubleshooting

### "Connection timeout - is the server running?"

**Solutions:**
- Verify the LLM server is running (check terminal/process list)
- Check the port number matches your configuration
- Try accessing the endpoint directly: `curl http://localhost:11434/v1/models`
- Restart the server

### "Model not found" or "Model not available"

**Solutions:**
- Verify the model name matches exactly (case-sensitive)
- For Ollama: Run `ollama list` to see installed models
- Pull the model if missing: `ollama pull <model-name>`
- Check server logs for model loading errors

### Slow Response Times

**Solutions:**
- Use a smaller model (7B instead of 13B+)
- Close other applications to free RAM
- Enable GPU acceleration if available
- Reduce `max_tokens` in advanced settings
- Check system CPU/RAM usage

### Server Crashes or Out of Memory

**Solutions:**
- Use a smaller model
- Reduce `max_tokens` parameter
- Close other applications
- Restart the server
- Check system RAM availability

### Port Already in Use

**Solutions:**
- Stop other services using the port
- Change the port in your LLM server configuration
- Update Redstring endpoint URL to match new port

## Privacy and Security

### Data Privacy

- **All data stays local** - No API calls leave your machine
- **No cloud processing** - Everything runs on your hardware
- **No data collection** - Your conversations remain private

### Security Considerations

- Local servers typically don't require API keys
- If your server requires authentication, configure it in Redstring
- Firewall rules may block localhost connections - adjust if needed
- Keep your LLM server software updated

## Performance Comparison

### Local vs Cloud Models

**Local Advantages:**
- ✅ Zero API costs
- ✅ Complete privacy
- ✅ Works offline
- ✅ Lower latency (no network)
- ✅ No rate limits

**Local Disadvantages:**
- ❌ Requires powerful hardware
- ❌ Slower inference (CPU vs cloud GPU)
- ❌ Limited model selection
- ❌ Higher system resource usage

**Cloud Advantages:**
- ✅ No hardware requirements
- ✅ Fast inference (cloud GPUs)
- ✅ Access to latest models
- ✅ No system resource usage

**Cloud Disadvantages:**
- ❌ API costs
- ❌ Data sent to external servers
- ❌ Requires internet connection
- ❌ Rate limits

## Advanced Configuration

### Custom Endpoints

You can configure custom endpoints for:
- Remote servers on your network
- Docker containers
- Cloud instances with OpenAI-compatible APIs
- Reverse proxies

Example: `http://192.168.1.100:11434/v1/chat/completions`

### API Key Configuration

Most local servers don't require API keys. If your server does:
1. Enter the API key in Redstring configuration
2. The key will be stored locally (obfuscated)
3. Sent in `Authorization: Bearer <key>` header

### Model Parameters

Adjust in Advanced Settings:
- **Temperature** - Controls randomness (0.0-1.0)
- **Max Tokens** - Maximum response length
- **System Prompt** - Customize Wizard behavior

## Best Practices

1. **Start with Ollama** - Easiest to set up and use
2. **Test connection** before using - Verify server is accessible
3. **Monitor resources** - Local models can be resource-intensive
4. **Use appropriate models** - Match model size to your hardware
5. **Keep servers updated** - Get latest features and fixes
6. **Document your setup** - Note which models work best for your use case

## Getting Help

### Common Issues

- **Server won't start** - Check installation, ports, and logs
- **Models won't load** - Verify disk space and model files
- **Slow performance** - Check system resources and model size
- **Connection errors** - Verify endpoint URL and server status

### Resources

- **Ollama:** [ollama.com](https://ollama.com) | [GitHub](https://github.com/ollama/ollama)
- **LM Studio:** [lmstudio.ai](https://lmstudio.ai)
- **LocalAI:** [localai.io](https://localai.io) | [GitHub](https://github.com/mudler/LocalAI)
- **vLLM:** [docs.vllm.ai](https://docs.vllm.ai) | [GitHub](https://github.com/vllm-project/vllm)

## Example Workflows

### Basic Graph Creation

1. Start Ollama: `ollama serve`
2. Pull model: `ollama pull llama2`
3. Configure in Redstring (Ollama preset)
4. Ask Wizard: "Create a graph about renewable energy"
5. Wizard generates nodes and edges using local model

### Switching Between Providers

1. Configure multiple profiles:
   - Profile 1: Ollama (local, llama2)
   - Profile 2: OpenRouter (cloud, claude-3-sonnet)
2. Switch profiles as needed
3. Each profile maintains its own configuration

### Testing Different Models

1. Pull multiple models: `ollama pull llama2 llama3 mistral`
2. Test each model with same prompt
3. Compare response quality and speed
4. Choose best model for your use case

## Conclusion

Local LLM integration provides a powerful, private alternative to cloud-based AI services. With Redstring's support for OpenAI-compatible endpoints, you can use any local LLM server that fits your needs.

Start with Ollama for the easiest setup, then explore other providers as needed. Remember to test connections, monitor system resources, and choose models appropriate for your hardware.


