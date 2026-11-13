        let notifying = null;
        const messageElements = [];

        function showStatus(elementId, message, type = 'info') {
            const element = document.getElementById(elementId);
            element.textContent = message;
            element.className = `status ${type}`;
            element.style.display = 'block';

            // Auto-hide after 5 seconds for success
            if (type === 'success') {
                setTimeout(() => {
                    element.style.display = 'none';
                }, 5000);
            }
        }

        function addMessage(text, type = 'received') {
            const container = document.getElementById('messagesList');

            // Remove empty state
            const emptyState = container.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }

            const messageEl = document.createElement('div');
            messageEl.className = `message ${type}`;
            messageEl.textContent = text;
            container.appendChild(messageEl);

            // Keep only last 50 messages
            const messages = container.querySelectorAll('.message');
            if (messages.length > 50) {
                messages[0].remove();
            }

            // Auto-scroll to bottom
            container.scrollTop = container.scrollHeight;
        }

        function clearMessages() {
            const container = document.getElementById('messagesList');
            container.innerHTML = '<div class="empty-state">No messages received yet</div>';
        }

        function updateSubscriptionsList() {
            if (!notifying) return;

            const subscriptions = notifying.getSubscriptions();
            const container = document.getElementById('subscriptionsList');

            if (Object.keys(subscriptions).length === 0) {
                container.innerHTML = '<div class="empty-state">No active subscriptions</div>';
                return;
            }

            container.innerHTML = '';
            for (const [topic, subIds] of Object.entries(subscriptions)) {
                for (const subId of subIds) {
                    const item = document.createElement('div');
                    item.className = 'subscription-item';
                    item.innerHTML = `
                        <div class="subscription-info">
                            <div class="subscription-topic">📌 ${topic}</div>
                            <div class="subscription-id">${subId}</div>
                        </div>
                        <button class="btn-small" onclick="unsubscribe('${topic}', '${subId}')">Remove</button>
                    `;
                    container.appendChild(item);
                }
            }
        }

        async function initializeService() {
            try {
                const instanceName = document.getElementById('instanceName').value;
                notifying = new nooblyjsNotifying({ instanceName });
                const status = await notifying.getStatus();
                showStatus('initStatus', `✓ Service initialized (${instanceName}): ${status}`, 'success');
            } catch (error) {
                showStatus('initStatus', `✗ Error: ${error.message}`, 'error');
                addMessage(`Error initializing service: ${error.message}`, 'error');
            }
        }

        async function createTopic() {
            if (!notifying) {
                showStatus('topicStatus', '✗ Service not initialized', 'error');
                return;
            }

            try {
                const topic = document.getElementById('topicName').value.trim();
                if (!topic) {
                    showStatus('topicStatus', '✗ Please enter a topic name', 'error');
                    return;
                }
                await notifying.createTopic(topic);
                showStatus('topicStatus', `✓ Topic "${topic}" created successfully`, 'success');
                addMessage(`Created topic: ${topic}`);
            } catch (error) {
                showStatus('topicStatus', `✗ Error: ${error.message}`, 'error');
                addMessage(`Error creating topic: ${error.message}`, 'error');
            }
        }

        async function subscribeToTopic() {
            if (!notifying) {
                showStatus('subscriptionStatus', '✗ Service not initialized', 'error');
                return;
            }

            try {
                const topic = document.getElementById('subscribeTopic').value.trim();
                if (!topic) {
                    showStatus('subscriptionStatus', '✗ Please enter a topic name', 'error');
                    return;
                }

                const subscription = await notifying.subscribe(topic, (message) => {
                    addMessage(`[${topic}] ${JSON.stringify(message)}`);
                });

                showStatus('subscriptionStatus',
                    `✓ Subscribed to "${topic}" (ID: ${subscription.subscriptionId.substring(0, 8)}...)`,
                    'success');
                addMessage(`Subscribed to topic: ${topic}`);
                updateSubscriptionsList();
            } catch (error) {
                showStatus('subscriptionStatus', `✗ Error: ${error.message}`, 'error');
                addMessage(`Error subscribing: ${error.message}`, 'error');
            }
        }

        async function unsubscribeFromTopic() {
            if (!notifying) {
                showStatus('subscriptionStatus', '✗ Service not initialized', 'error');
                return;
            }

            try {
                const topic = document.getElementById('subscribeTopic').value.trim();
                if (!topic) {
                    showStatus('subscriptionStatus', '✗ Please enter a topic name', 'error');
                    return;
                }

                await notifying.unsubscribe(topic);
                showStatus('subscriptionStatus', `✓ Unsubscribed from "${topic}"`, 'success');
                addMessage(`Unsubscribed from topic: ${topic}`);
                updateSubscriptionsList();
            } catch (error) {
                showStatus('subscriptionStatus', `✗ Error: ${error.message}`, 'error');
                addMessage(`Error unsubscribing: ${error.message}`, 'error');
            }
        }

        async function unsubscribe(topic, subId) {
            if (!notifying) return;
            try {
                await notifying.unsubscribe(topic, subId);
                showStatus('subscriptionStatus', `✓ Unsubscribed from "${topic}"`, 'success');
                updateSubscriptionsList();
            } catch (error) {
                showStatus('subscriptionStatus', `✗ Error: ${error.message}`, 'error');
            }
        }

        async function publishNotification() {
            if (!notifying) {
                showStatus('publishStatus', '✗ Service not initialized', 'error');
                return;
            }

            try {
                const topic = document.getElementById('publishTopic').value.trim();
                const messageStr = document.getElementById('messageData').value.trim();

                if (!topic) {
                    showStatus('publishStatus', '✗ Please enter a topic name', 'error');
                    return;
                }

                let message;
                if (messageStr) {
                    try {
                        message = JSON.parse(messageStr);
                    } catch (e) {
                        showStatus('publishStatus', '✗ Invalid JSON in message', 'error');
                        return;
                    }
                } else {
                    message = { timestamp: new Date().toISOString() };
                }

                await notifying.notify(topic, message);
                showStatus('publishStatus', `✓ Notification published to "${topic}"`, 'success');
                addMessage(`Published to ${topic}: ${JSON.stringify(message)}`);
            } catch (error) {
                showStatus('publishStatus', `✗ Error: ${error.message}`, 'error');
                addMessage(`Error publishing: ${error.message}`, 'error');
            }
        }

        // Initialize on page load
        window.addEventListener('load', () => {
            addMessage('Page loaded. Click "Initialize Service" to start.');
        });
    
