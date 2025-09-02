/**
 * @fileoverview AI Service Usage Examples
 * Examples showing how to use the AI service with different providers.
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

const createAIService = require('./index');
const EventEmitter = require('events');

// Example usage for different providers
async function examples() {
  const eventEmitter = new EventEmitter();

  // Set up event listeners for monitoring
  eventEmitter.on('ai:prompt', (data) => {
    console.log(`Prompt processed by ${data.response.provider}: ${data.prompt.substring(0, 50)}...`);
  });

  eventEmitter.on('ai:usage', (data) => {
    console.log(`Token usage: ${data.totalTokens} tokens, estimated cost: $${data.estimatedCost.toFixed(6)}`);
  });

  // Example 1: Claude Provider
  console.log('=== Claude Provider Example ===');
  try {
    const claude = createAIService('claude', {
      apiKey: process.env.ANTHROPIC_API_KEY, // Set this in your environment
      model: 'claude-3-5-sonnet-20241022',
      tokensStorePath: './claude-tokens.json'
    }, eventEmitter);

    if (process.env.ANTHROPIC_API_KEY) {
      const response = await claude.prompt('Explain quantum computing in one sentence.', {
        maxTokens: 100,
        temperature: 0.7
      });
      console.log('Claude response:', response.content);
      console.log('Usage:', response.usage);
    } else {
      console.log('Set ANTHROPIC_API_KEY environment variable to test Claude');
    }
  } catch (error) {
    console.log('Claude setup failed:', error.message);
  }

  // Example 2: OpenAI Provider
  console.log('\n=== OpenAI Provider Example ===');
  try {
    const openai = createAIService('chatgpt', {
      apiKey: process.env.OPENAI_API_KEY, // Set this in your environment
      model: 'gpt-3.5-turbo',
      tokensStorePath: './openai-tokens.json'
    }, eventEmitter);

    if (process.env.OPENAI_API_KEY) {
      const response = await openai.prompt('What is machine learning?', {
        maxTokens: 100,
        temperature: 0.7
      });
      console.log('OpenAI response:', response.content);
      console.log('Usage:', response.usage);
    } else {
      console.log('Set OPENAI_API_KEY environment variable to test OpenAI');
    }
  } catch (error) {
    console.log('OpenAI setup failed:', error.message);
  }

  // Example 3: Ollama Provider (local)
  console.log('\n=== Ollama Provider Example ===');
  try {
    const ollama = createAIService('ollama', {
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2',
      tokensStorePath: './ollama-tokens.json'
    }, eventEmitter);

    const isRunning = await ollama.isRunning();
    if (isRunning) {
      const response = await ollama.prompt('Hello, how are you?', {
        temperature: 0.7
      });
      console.log('Ollama response:', response.content);
      console.log('Usage (estimated):', response.usage);
      
      // List available models
      const models = await ollama.listModels();
      console.log('Available models:', models.map(m => m.name));
    } else {
      console.log('Ollama service is not running. Start it with: ollama serve');
    }
  } catch (error) {
    console.log('Ollama test failed:', error.message);
  }

  // Example 4: Using with Express.js
  console.log('\n=== Express.js Integration Example ===');
  console.log(`
// In your Express.js application:
const express = require('express');
const createAIService = require('./src/aiservice');
const EventEmitter = require('events');

const app = express();
const eventEmitter = new EventEmitter();

// Create AI service instance
const aiService = createAIService('claude', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  'express-app': app
}, eventEmitter);

// The routes are automatically configured:
// POST /services/ai/api/prompt - Send prompts
// GET /services/ai/api/status - Check service status
// GET /services/ai/api/analytics - Get usage analytics
// GET /services/ai/api/models - List available models (Ollama only)
// GET /services/ai/api/health - Health check

app.listen(3000, () => {
  console.log('AI service running on port 3000');
});
  `);
}

// Run examples if this file is executed directly
if (require.main === module) {
  examples().catch(console.error);
}

module.exports = examples;