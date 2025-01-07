
// Global state
let currentEntryId = 0;
let readProvider;  // Always connected to zkSync Sepolia
let readContract;  // Read-only contract instance
let writeProvider; // Connected to wallet
let writeContract; // Contract instance for transactions
let signer;
let userAddress;
let dataCache = {
    lastUpdate: 0,
    data: {},
    version: 0,
    pendingUpdates: new Set(),
    processedTransactions: new Set()
};

// Update initializeApp
async function initializeApp() {
    try {
        // Set up read-only provider and contract
        readProvider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        readContract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, readProvider);

        // Set up wallet connection button
        const walletButton = document.getElementById('wallet-button');
        if (walletButton) {
            walletButton.addEventListener('click', async () => {
                if (userAddress) {
                    await disconnectWallet();
                } else {
                    await connectWallet();
                }
            });
        }

        // Set up network change listener
        if (window.ethereum) {
            window.ethereum.on('chainChanged', handleChainChange);
            window.ethereum.on('accountsChanged', handleAccountsChanged);
        }

        // Start periodic data updates
        fetchLatestData();
        startPeriodicUpdates();

    } catch (error) {
        console.error('Initialization error:', error);
        showStatus(`Initialization error: ${error.message}`, 'error');
    }
}

// Update fetchLatestData to use readContract
async function fetchLatestData() {
    try {
        const entry = await readContract.getFullEntry(currentEntryId);
        await displayEntryAndChoices(entry);
        dataCache.lastUpdate = Date.now();
    } catch (error) {
        console.error('Error fetching data:', error);
        showStatus('Error fetching story data', 'error');
    }
}

// Update wallet connection to handle write provider separately
async function connectWallet() {
    if (typeof window.ethereum === 'undefined') {
        showStatus('No Web3 wallet detected. Please install MetaMask or similar.', 'error');
        return false;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        userAddress = accounts[0];

        if (!await checkAndSwitchNetwork()) {
            return false;
        }

        writeProvider = new ethers.providers.Web3Provider(window.ethereum);
        signer = writeProvider.getSigner();
        writeContract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, signer);

        showStatus('Wallet connected successfully', 'success');
        updateWalletDisplay();
        return true;

    } catch (error) {
        console.error('Wallet connection error:', error);
        showStatus(`Failed to connect wallet: ${error.message}`, 'error');
        return false;
    }
}

function disconnectWallet() {
    userAddress = null;
    signer = null;
    writeProvider = null;
    writeContract = null;
    updateWalletDisplay();
    showStatus('Wallet disconnected', 'success');
}

// Network Management
async function checkAndSwitchNetwork() {
    try {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });

        if (chainId !== CONFIG.NETWORK_ID) {
            showStatus(`Please switch to ${CONFIG.NETWORK_NAME}`, 'warning');

            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: CONFIG.NETWORK_ID }],
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await addNetwork();
                } else {
                    throw switchError;
                }
            }

            return true;
        }

        return true;
    } catch (error) {
        showStatus(`Network switch failed: ${error.message}`, 'error');
        return false;
    }
}

async function addNetwork() {
    try {
        await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
                chainId: CONFIG.NETWORK_ID,
                chainName: CONFIG.NETWORK_NAME,
                nativeCurrency: {
                    name: 'ETH',
                    symbol: 'ETH',
                    decimals: 18
                },
                rpcUrls: [CONFIG.RPC_URL],
                blockExplorerUrls: [CONFIG.EXPLORER_URL]
            }]
        });
    } catch (error) {
        throw new Error(`Failed to add network: ${error.message}`);
    }
}

// Data Management
async function fetchDataBatch(startIndex, batchSize) {
    const promises = [];
    for (let i = 0; i < batchSize && (startIndex + i) < CONFIG.MAX_ITEMS; i++) {
        promises.push(
            contract.getData(startIndex + i)
                .then(data => ({
                    index: startIndex + i,
                    data,
                    error: null
                }))
                .catch(error => ({
                    index: startIndex + i,
                    data: null,
                    error
                }))
        );
    }
    return Promise.all(promises);
}

async function processDataQueue() {
    if (dataCache.isProcessing) return;

    try {
        dataCache.isProcessing = true;

        while (dataCache.pendingUpdates.size > 0) {
            const updates = Array.from(dataCache.pendingUpdates);
            dataCache.pendingUpdates.clear();

            for (let i = 0; i < updates.length; i += CONFIG.BATCH_SIZE) {
                const batch = updates.slice(i, i + CONFIG.BATCH_SIZE);
                await Promise.all(batch.map(updateSingleItem));

                if (i + CONFIG.BATCH_SIZE < updates.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }
    } finally {
        dataCache.isProcessing = false;
        if (dataCache.pendingUpdates.size > 0) {
            processDataQueue();
        }
    }
}

function setupEventListener() {
    if (contract) {
        contract.removeAllListeners("DataUpdated");

        contract.on("DataUpdated", (id, event) => {
            if (dataCache.processedTransactions.has(event.transactionHash)) {
                return;
            }

            dataCache.processedTransactions.add(event.transactionHash);
            dataCache.pendingUpdates.add(id.toNumber());
            processDataQueue();
        });
    }
}

// UI Updates
function updateWalletDisplay() {
    const walletDisplay = document.getElementById('wallet-display');
    if (!walletDisplay) return;

    if (userAddress) {
        walletDisplay.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    } else {
        walletDisplay.textContent = 'No wallet connected';
    }
}

async function displayEntryAndChoices(fullEntry) {
    const [origin, choice, content, end, next, score, author] = fullEntry;

    // Display the entry content
    const contentDiv = document.getElementById('content');
    contentDiv.textContent = content;

    // Get and display choices
    const choicesDiv = document.getElementById('choices');
    choicesDiv.innerHTML = ''; // Clear existing choices

    // If this is an ending, show the "Start Over" button
    if (end) {
        const startOverButton = document.createElement('button');
        startOverButton.className = 'choice-button';
        startOverButton.textContent = 'Start Over';
        startOverButton.addEventListener('click', async () => {
            currentEntryId = 0;
            await fetchLatestData();
        });
        choicesDiv.appendChild(startOverButton);
    }

    // For each next entry ID in the array
    for (const nextId of next) {
        try {
            const nextEntry = await readContract.entries(nextId);

            const choiceButton = document.createElement('button');
            choiceButton.className = 'choice-button';
            choiceButton.textContent = nextEntry.choice;

            choiceButton.addEventListener('click', async () => {
                currentEntryId = nextId;
                await fetchLatestData();
            });

            choicesDiv.appendChild(choiceButton);
        } catch (error) {
            console.error(`Error fetching choice ${nextId}:`, error);
        }
    }

    // Add contribution button if this isn't an ending
    if (!end) {
        const contributeButton = document.createElement('button');
        contributeButton.id = 'contribute-button';
        contributeButton.className = 'choice-button';
        contributeButton.textContent = 'Add your own...';
        contributeButton.onclick = showContributionModal;
        choicesDiv.appendChild(contributeButton);
    }
}


// Update the status display function to show the div
function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('status-messages');
    if (!statusElement) return;

    statusElement.style.display = 'block';
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;

    setTimeout(() => {
        statusElement.style.display = 'none';
    }, 5000);
}

// Update chain change handler to only affect wallet connection
function handleChainChange() {
    // Only reconnect wallet if we were connected
    if (userAddress) {
        connectWallet();
    }
}

function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        disconnectWallet();
    } else if (accounts[0] !== userAddress) {
        userAddress = accounts[0];
        connectWallet();
    }
}

// Periodic Updates
function startPeriodicUpdates() {

    // Set up periodic updates
    setInterval(() => {
        if (Date.now() - dataCache.lastUpdate > CONFIG.CACHE_DURATION) {
            fetchLatestData();
        }
    }, CONFIG.UPDATE_INTERVAL);
}

// Modal management
function showContributionModal() {
    const modal = document.getElementById('contribution-modal');
    modal.style.display = 'block';
}

function hideContributionModal() {
    const modal = document.getElementById('contribution-modal');
    modal.style.display = 'none';

    // Clear form
    document.getElementById('choice-text').value = '';
    document.getElementById('content-text').value = '';
    document.getElementById('is-ending').checked = false;
}

// Update submission to use writeContract
async function submitContribution() {
    const choiceText = document.getElementById('choice-text').value;
    const contentText = document.getElementById('content-text').value;
    const isEnding = document.getElementById('is-ending').checked;

    if (!choiceText || !contentText) {
        showStatus('Please fill in both fields', 'error');
        return;
    }

    // Connect wallet if not connected
    if (!userAddress) {
        const connected = await connectWallet();
        if (!connected) return;
    }

    try {
        const tx = await writeContract.contribute(
            currentEntryId,
            choiceText,
            contentText,
            isEnding,
            { value: ethers.utils.parseEther("0.0001") }
        );

        showStatus('Transaction submitted! Waiting for confirmation...', 'info');
        await tx.wait();
        showStatus('Entry added successfully!', 'success');
        hideContributionModal();
        await fetchLatestData();  // Refresh the display

    } catch (error) {
        console.error('Error submitting entry:', error);
        showStatus(`Failed to submit entry: ${error.message}`, 'error');
    }
}

// Setup event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cancel-entry').onclick = hideContributionModal;
    document.getElementById('submit-entry').onclick = submitContribution;

    // Add character counters
    const choiceInput = document.getElementById('choice-text');
    const contentInput = document.getElementById('content-text');

    choiceInput.oninput = () => {
        const count = choiceInput.value.length;
        choiceInput.parentElement.querySelector('.character-count').textContent = `${count}/128`;
    };

    contentInput.oninput = () => {
        const count = contentInput.value.length;
        contentInput.parentElement.querySelector('.character-count').textContent = `${count}/2048`;
    };
});

// Initialize on load
window.addEventListener('load', initializeApp);