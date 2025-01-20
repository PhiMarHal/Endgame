
// Global state
let currentNexusId = 0;  // Changed from currentEntryId
let readProvider;
let readContract;
let writeProvider;
let writeContract;
let signer;
let userAddress;
let dataCache = {
    lastUpdate: 0,
    nexuses: new Map(),
    optios: new Map(),
    pendingUpdates: new Set()
};
let discoveredEntries = new Set([0]); // Start with entry 0

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

        // Set up event listener
        setupEntryEventListener();

        // Start periodic data updates
        fetchLatestData();
        startPeriodicUpdates();

    } catch (error) {
        console.error('Initialization error:', error);
        showStatus(`Initialization error: ${error.message}`, 'error');
    }
}

function normalizeId(id) {
    return typeof id === 'object' && id.toNumber ? id.toNumber() : Number(id);
}

async function fetchLatestData() {
    try {
        const data = await fetchNexusAndOptionsData(currentNexusId);
        await displayNexusAndOptios(data);
        dataCache.lastUpdate = Date.now();
    } catch (error) {
        console.error('Error fetching data:', error);
        showStatus('Error fetching story data', 'error');
    }
}

function showNexusModal() {
    const modal = document.getElementById('nexus-modal');
    modal.style.display = 'block';
}

function hideNexusModal() {
    const modal = document.getElementById('nexus-modal');
    modal.style.display = 'none';
    document.getElementById('nexus-content').value = '';
}

function showOptioModal() {
    const modal = document.getElementById('optio-modal');
    modal.style.display = 'block';
}

function hideOptioModal() {
    const modal = document.getElementById('optio-modal');
    modal.style.display = 'none';
    document.getElementById('optio-content').value = '';
    document.getElementById('destination-id').value = '';
}

async function displayNexusAndOptios(data) {
    try {
        // Display nexus content
        const contentDiv = document.getElementById('content');
        contentDiv.textContent = data.nexus.content;

        // Get and display optios
        const choicesDiv = document.getElementById('choices');
        choicesDiv.innerHTML = '';

        // Add Get Back button if not at the start
        if (currentNexusId !== 0) {
            // We'll need to implement this later when we track navigation history
        }

        // Display each optio
        for (const optio of data.optios) {
            const choiceButton = document.createElement('button');
            choiceButton.className = 'choice-button';
            choiceButton.textContent = `${optio.content} (${optio.id} → ${optio.destination})`;

            choiceButton.addEventListener('click', async () => {
                currentNexusId = optio.destination;
                await fetchLatestData();
            });

            choicesDiv.appendChild(choiceButton);
        }

        // Add contribution buttons
        const createNexusButton = document.createElement('button');
        createNexusButton.className = 'choice-button';
        createNexusButton.textContent = 'Create New Nexus...';
        createNexusButton.onclick = showNexusModal;
        choicesDiv.appendChild(createNexusButton);

        const createOptioButton = document.createElement('button');
        createOptioButton.className = 'choice-button';
        createOptioButton.textContent = 'Link Nexuses...';
        createOptioButton.onclick = showOptioModal;
        choicesDiv.appendChild(createOptioButton);

    } catch (error) {
        console.error('Error displaying nexus:', error);
        showStatus('Error displaying content', 'error');
    }
}

async function submitNexus() {
    const content = document.getElementById('nexus-content').value;

    if (!content) {
        showStatus('Please fill in the content', 'error');
        return;
    }

    if (!userAddress) {
        const connected = await connectWallet();
        if (!connected) return;
    }

    try {
        const tx = await writeContract.contribute(
            content,
            { value: ethers.utils.parseEther("0.00004") }
        );

        showStatus('Transaction submitted! Waiting for confirmation...', 'info');
        await tx.wait();
        showStatus('Nexus created successfully!', 'success');
        hideNexusModal();
        await fetchLatestData();

    } catch (error) {
        console.error('Error submitting nexus:', error);
        showStatus(`Failed to submit nexus: ${error.message}`, 'error');
    }
}

async function submitOptio() {
    const content = document.getElementById('optio-content').value;
    const destId = document.getElementById('destination-id').value;

    if (!content || !destId) {
        showStatus('Please fill in all fields', 'error');
        return;
    }

    if (!userAddress) {
        const connected = await connectWallet();
        if (!connected) return;
    }

    try {
        const tx = await writeContract.bind(
            currentNexusId,
            destId,
            content,
            { value: ethers.utils.parseEther("0.00004") }
        );

        showStatus('Transaction submitted! Waiting for confirmation...', 'info');
        await tx.wait();
        showStatus('Link created successfully!', 'success');
        hideOptioModal();
        await fetchLatestData();

    } catch (error) {
        console.error('Error creating link:', error);
        showStatus(`Failed to create link: ${error.message}`, 'error');
    }
}

async function fetchNexusAndOptionsData(nexusId) {
    try {
        // Get the nexus first to get its optio IDs
        const nexusData = await readContract.getFullNexusBatch([nexusId]);
        const [authors, contents, nexts] = nexusData;

        let optiosData = []; // Initialize empty array for optios

        // If this nexus has optios, fetch them all at once
        if (nexts[0] && nexts[0].length > 0) {
            const optioData = await readContract.getFullOptioBatch(nexts[0]);
            const [optioAuthors, optioContents, origins, destinations, scores] = optioData;

            // Map the optio data
            optiosData = nexts[0].map((optioId, index) => ({
                id: optioId,
                author: optioAuthors[index],
                content: optioContents[index],
                origin: origins[index],
                destination: destinations[index],
                score: scores[index]
            }));

            // Store in cache
            nexts[0].forEach((optioId, index) => {
                dataCache.optios.set(optioId, {
                    author: optioAuthors[index],
                    content: optioContents[index],
                    origin: origins[index],
                    destination: destinations[index],
                    score: scores[index]
                });
            });
        }

        // Store nexus in cache
        dataCache.nexuses.set(nexusId, {
            author: authors[0],
            content: contents[0],
            next: nexts[0]
        });

        return {
            nexus: {
                author: authors[0],
                content: contents[0],
                next: nexts[0]
            },
            optios: optiosData
        };
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

async function displayEntryAndChoices(fullEntry) {
    let origin, choice, content, end, next, score, author;

    if (Array.isArray(fullEntry)) {
        [origin, choice, content, end, next, score, author] = fullEntry;
    } else {
        ({ origin, choice, content, end, next, score, author } = fullEntry);
    }

    next = Array.isArray(next) ? next : [];

    // Display the entry content
    const contentDiv = document.getElementById('content');
    contentDiv.textContent = content;

    // Get and display choices
    const choicesDiv = document.getElementById('choices');
    choicesDiv.innerHTML = '';

    // Add Get Back button if not at the start
    if (currentNexusId !== 0) {
        const backButton = document.createElement('button');
        backButton.className = 'choice-button';
        backButton.textContent = `Get Back (${normalizeId(origin)})`;
        backButton.addEventListener('click', async () => {
            currentNexusId = normalizeId(origin);
            await fetchLatestData();
        });
        choicesDiv.appendChild(backButton);
    }

    // If this is an ending, show the Start Over button
    if (end) {
        const startOverButton = document.createElement('button');
        startOverButton.className = 'choice-button';
        startOverButton.textContent = 'Start Over';
        startOverButton.addEventListener('click', async () => {
            currentNexusId = 0;
            await fetchLatestData();
        });
        choicesDiv.appendChild(startOverButton);
    }

    // For each next entry ID in the array
    for (const nextId of next) {
        try {
            const nextEntry = dataCache.entries.get(normalizeId(nextId));
            if (!nextEntry) {
                console.warn(`Entry ${nextId} not found in cache - this shouldn't happen due to pre-fetching`);
                continue;
            }

            const choiceButton = document.createElement('button');
            choiceButton.className = 'choice-button';
            choiceButton.textContent = `${Array.isArray(nextEntry) ? nextEntry[1] : nextEntry.choice} (${normalizeId(nextId)})`;

            choiceButton.addEventListener('click', async () => {
                currentNexusId = normalizeId(nextId);
                await fetchLatestData();
            });

            choicesDiv.appendChild(choiceButton);
        } catch (error) {
            console.error(`Error handling choice ${nextId}:`, error);
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

function setupEntryEventListener() {
    if (readContract) {
        // Listen for new nexuses
        const nexusFilter = readContract.filters.CreatedNexus();
        readContract.on(nexusFilter, async (id, event) => {
            console.log('New nexus created:', id.toNumber());

            // Clear cache entry if it exists
            dataCache.nexuses.delete(id);

            // If we want to refresh the current view when any new nexus is created
            // await fetchLatestData();
        });

        // Listen for new optios
        const optioFilter = readContract.filters.LinkedOptio();
        readContract.on(optioFilter, async (id, origin, destination, event) => {
            console.log('New optio created:', {
                id: id.toNumber(),
                origin: origin.toNumber(),
                destination: destination.toNumber()
            });

            // Clear cache for the origin nexus since its 'next' array changed
            dataCache.nexuses.delete(origin);
            dataCache.optios.delete(id);

            // If we're currently viewing the origin, refresh the display
            if (currentNexusId === origin.toNumber()) {
                showStatus('New path added!', 'success');
                await fetchLatestData();
            }
        });
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
        updateMoneyData();
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

// Add these functions
function showNameModal() {
    const modal = document.getElementById('name-modal');
    modal.style.display = 'block';
}

function hideNameModal() {
    const modal = document.getElementById('name-modal');
    modal.style.display = 'none';
    document.getElementById('name-input').value = '';
}

async function registerName() {
    const nameInput = document.getElementById('name-input').value.trim();
    if (!nameInput) {
        showStatus('Please enter a name', 'error');
        return;
    }

    try {
        const tx = await writeContract.register(nameInput);
        showStatus('Registering name...', 'info');
        await tx.wait();
        showStatus('Name registered successfully!', 'success');
        hideNameModal();
        updateWalletDisplay(); // This will now hide the register button
    } catch (error) {
        console.error('Error registering name:', error);
        showStatus(`Failed to register name: ${error.message}`, 'error');
    }
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
async function updateWalletDisplay() {
    const walletDisplay = document.getElementById('wallet-display');
    const walletButton = document.getElementById('wallet-button');
    const registerButton = document.getElementById('register-name');

    if (!walletDisplay || !walletButton) return;

    if (userAddress) {
        walletButton.textContent = 'Disconnect Wallet';

        // Check if user has a registered name
        try {
            const name = await readContract.addressToName(userAddress);
            if (name) {
                walletDisplay.textContent = `${name} (${userAddress.slice(0, 6)}...${userAddress.slice(-4)})`;
                registerButton.style.display = 'none';
            } else {
                walletDisplay.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
                registerButton.style.display = 'block';
            }
        } catch (error) {
            console.error('Error fetching name:', error);
            walletDisplay.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
        }
    } else {
        walletButton.textContent = 'Connect Wallet';
        walletDisplay.textContent = 'Not connected';
        registerButton.style.display = 'none';
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
            currentNexusId,
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

// View Management
function switchView(viewName) {
    console.log('switchView called with:', viewName);

    // Hide all views
    document.querySelectorAll('.view-section').forEach(view => {
        view.style.display = 'none';
    });

    // Show selected view
    const selectedView = document.getElementById(`${viewName}-view`);
    console.log('Selected view element:', selectedView);
    if (selectedView) {
        selectedView.style.display = 'block';
    }

    // Update nav buttons
    document.querySelectorAll('.nav-button').forEach(button => {
        button.classList.remove('active');
        if (button.dataset.view === viewName) {
            button.classList.add('active');
        }
    });

    // If switching to money view, update the data
    if (viewName === 'money') {
        console.log('Updating money data');
        updateMoneyData();
    }
}

// Money View Functions
async function updateMoneyData() {
    try {
        // Get current bid
        const currentBid = await readContract.getCurrentBid();
        document.getElementById('current-bid').textContent =
            `${ethers.utils.formatEther(currentBid)} END`;

        // Get treasury balance and calculate pot
        const treasury = await readContract.fiscus();  // Changed from treasuryBalance
        const pot = treasury.div(10); // 10% of treasury
        document.getElementById('treasury-display').textContent =
            `${ethers.utils.formatEther(pot)} ETH`;

        // Get user's balances if connected
        if (userAddress) {
            // Get ETH balance
            const ethBalance = await readContract.summa(userAddress);  // Changed from etherBalance
            document.getElementById('ether-balance').textContent =
                `${ethers.utils.formatEther(ethBalance)} ETH`;

            // Get END token balance
            const tokenBalance = await readContract.balanceOf(userAddress);
            document.getElementById('token-balance').textContent =
                `${ethers.utils.formatEther(tokenBalance)} END`;
        } else {
            document.getElementById('ether-balance').textContent = 'Connect wallet to view';
            document.getElementById('token-balance').textContent = 'Connect wallet to view';
        }
    } catch (error) {
        console.error('Error updating money data:', error);
        showStatus('Failed to update monetary information', 'error');
    }
}

// Setup event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Add view switching listeners
    document.querySelectorAll('.nav-button').forEach(button => {
        button.addEventListener('click', () => {
            console.log('Switching to view:', button.dataset.view); // Debug log
            switchView(button.dataset.view);
        });
    });

    // Make sure elements exist before binding
    const cancelNexusButton = document.getElementById('cancel-nexus');
    const submitNexusButton = document.getElementById('submit-nexus');
    const cancelOptioButton = document.getElementById('cancel-optio');
    const submitOptioButton = document.getElementById('submit-optio');

    if (cancelNexusButton) cancelNexusButton.onclick = hideNexusModal;
    if (submitNexusButton) submitNexusButton.onclick = submitNexus;
    if (cancelOptioButton) cancelOptioButton.onclick = hideOptioModal;
    if (submitOptioButton) submitOptioButton.onclick = submitOptio;

    // Add character counters
    const nexusContent = document.getElementById('nexus-content');
    const optioContent = document.getElementById('optio-content');

    if (nexusContent) {
        nexusContent.oninput = () => {
            const count = nexusContent.value.length;
            nexusContent.parentElement.querySelector('.character-count').textContent = `${count}/2048`;
        };
    }

    if (optioContent) {
        optioContent.oninput = () => {
            const count = optioContent.value.length;
            optioContent.parentElement.querySelector('.character-count').textContent = `${count}/2048`;
        };
    }
});

// Initialize on load
window.addEventListener('load', initializeApp);