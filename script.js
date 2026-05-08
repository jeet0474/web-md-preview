document.addEventListener('DOMContentLoaded', () => {
    const openBtn = document.getElementById('openBtn');
    const openFolderBtn = document.getElementById('openFolderBtn');
    const closeFolderBtn = document.getElementById('closeFolderBtn');
    const clearAllBtn = document.getElementById('clearAllBtn');
    const syncFolderBtn = document.getElementById('syncFolderBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');
    const topBar = document.getElementById('topBar');
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    const tabsContainer = document.getElementById('tabsContainer');
    const contentArea = document.getElementById('contentArea');
    const explorerPanel = document.getElementById('explorerPanel');
    const explorerContent = document.getElementById('explorerContent');
    const folderNameDisplay = document.getElementById('folderName');
    const markdownContainer = document.getElementById('markdownContainer');
    const emptyState = document.getElementById('emptyState');

    let files = [];
    let activeIndex = -1;
    let folderMode = false;
    let folderStructure = createEmptyTree();
    let folderSources = {};
    let currentFolderName = '';
    let currentDirectoryHandle = null;
    let expandedFolders = new Set();

    restoreSession();

    minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        topBar.classList.add('collapsed');
    });

    topBar.addEventListener('click', () => {
        if (topBar.classList.contains('collapsed')) {
            topBar.classList.remove('collapsed');
        }
    });

    tabsContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        tabsContainer.scrollLeft += e.deltaY > 0 ? 50 : -50;
    });

    openBtn.addEventListener('click', () => {
        fileInput.click();
    });

    openFolderBtn.addEventListener('click', async () => {
        await openFolder();
    });

    closeFolderBtn.addEventListener('click', () => {
        exitFolderMode();
    });

    clearAllBtn.addEventListener('click', () => {
        clearWorkspace();
    });

    syncFolderBtn.addEventListener('click', async () => {
        await syncCurrentFolder({ forcePicker: !currentDirectoryHandle });
    });

    fileInput.addEventListener('change', async (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length > 0) {
            for (const file of selectedFiles) {
                await loadStandaloneFile(file);
            }
            fileInput.value = '';
        }
    });

    folderInput.addEventListener('change', async (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length > 0) {
            await enterFolderModeFromFileList(selectedFiles);
            folderInput.value = '';
        }
    });

    window.addEventListener('focus', async () => {
        if (!folderMode || !currentDirectoryHandle) {
            return;
        }
        await syncCurrentFolder({ silent: true, allowPrompt: false });
    });

    function createEmptyTree() {
        return { folders: [], files: [] };
    }

    function normalizePath(path) {
        return path.replace(/\\/g, '/');
    }

    function isMarkdownFileName(name) {
        const lower = name.toLowerCase();
        return lower.endsWith('.md') || lower.endsWith('.markdown');
    }

    function compareByName(a, b) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }

    function createExpandedSet(tree, basePath = '') {
        const expanded = new Set();
        for (const folder of tree.folders) {
            const folderPath = basePath ? `${basePath}/${folder.name}` : folder.name;
            expanded.add(folderPath);
            const childSet = createExpandedSet(folder, folderPath);
            childSet.forEach((value) => expanded.add(value));
        }
        return expanded;
    }

    function mergeExpandedFolders(tree) {
        const validPaths = createExpandedSet(tree);
        expandedFolders = new Set([...expandedFolders].filter((path) => validPaths.has(path)));
        validPaths.forEach((path) => {
            if (!expandedFolders.has(path)) {
                expandedFolders.add(path);
            }
        });
    }

    function setExplorerVisibility(visible) {
        explorerPanel.style.display = visible ? 'flex' : 'none';
        syncFolderBtn.hidden = !visible;
        closeFolderBtn.hidden = !visible;
        openFolderBtn.hidden = visible;
        contentArea.style.display = 'flex';
    }

    function clearWorkspace() {
        files = [];
        activeIndex = -1;
        exitFolderMode({ keepFiles: false });
        renderTabs();
        showEmptyState();
        localStorage.removeItem('mdViewerSession');
    }

    function exitFolderMode(options = {}) {
        const { keepFiles = false } = options;
        folderMode = false;
        folderStructure = createEmptyTree();
        folderSources = {};
        currentFolderName = '';
        currentDirectoryHandle = null;
        expandedFolders.clear();

        if (!keepFiles) {
            files = [];
            activeIndex = -1;
        }

        folderNameDisplay.textContent = 'Explorer';
        explorerContent.innerHTML = '';
        setExplorerVisibility(false);
        saveSession();
    }

    async function openFolder() {
        if (window.showDirectoryPicker) {
            try {
                const directoryHandle = await window.showDirectoryPicker();
                await enterFolderModeFromHandle(directoryHandle);
                return;
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    return;
                }
                console.warn('Directory picker failed, falling back to input snapshot.', error);
            }
        }
        folderInput.click();
    }

    async function ensureDirectoryPermission(handle, writable = false, prompt = false) {
        if (!handle || typeof handle.queryPermission !== 'function') {
            return true;
        }

        const options = writable ? { mode: 'readwrite' } : { mode: 'read' };
        const state = await handle.queryPermission(options);
        if (state === 'granted') {
            return true;
        }
        if (!prompt || typeof handle.requestPermission !== 'function') {
            return false;
        }
        return (await handle.requestPermission(options)) === 'granted';
    }

    async function enterFolderModeFromHandle(directoryHandle) {
        const hasPermission = await ensureDirectoryPermission(directoryHandle, false, true);
        if (!hasPermission) {
            return;
        }

        const scanResult = await scanDirectoryHandle(directoryHandle);
        if (!scanResult.tree.files.length && !scanResult.tree.folders.length) {
            alert('No markdown files found in the selected folder.');
            return;
        }

        currentDirectoryHandle = directoryHandle;
        currentFolderName = directoryHandle.name;
        applyFolderState(scanResult.tree, scanResult.sources, currentFolderName);
    }

    async function enterFolderModeFromFileList(selectedFiles) {
        const mdFiles = selectedFiles.filter((file) => isMarkdownFileName(file.name));
        if (mdFiles.length === 0) {
            alert('No markdown files found in the selected folder.');
            return;
        }

        const treeData = buildTreeFromFileList(mdFiles);
        const folderName = normalizePath(mdFiles[0].webkitRelativePath || mdFiles[0].name).split('/')[0];
        currentDirectoryHandle = null;
        currentFolderName = folderName;
        applyFolderState(treeData.tree, treeData.sources, folderName);
    }

    function applyFolderState(tree, sources, folderName) {
        folderMode = true;
        folderStructure = tree;
        folderSources = sources;
        folderNameDisplay.textContent = folderName || 'Explorer';
        files = [];
        activeIndex = -1;
        mergeExpandedFolders(tree);
        setExplorerVisibility(true);
        renderFolderTree();
        renderTabs();
        showEmptyState();
        saveSession();
    }

    async function syncCurrentFolder(options = {}) {
        const { forcePicker = false, silent = false, allowPrompt = true } = options;

        if (forcePicker) {
            await openFolder();
            return;
        }

        if (!currentDirectoryHandle) {
            folderInput.click();
            return;
        }

        const hasPermission = await ensureDirectoryPermission(currentDirectoryHandle, false, allowPrompt);
        if (!hasPermission) {
            if (!silent) {
                folderInput.click();
            }
            return;
        }

        try {
            const scanResult = await scanDirectoryHandle(currentDirectoryHandle);
            reconcileFolderState(scanResult.tree, scanResult.sources);
        } catch (error) {
            console.error('Folder sync failed', error);
            if (!silent) {
                folderInput.click();
            }
        }
    }

    function reconcileFolderState(tree, sources) {
        folderStructure = tree;
        folderSources = sources;
        folderNameDisplay.textContent = currentFolderName || 'Explorer';
        mergeExpandedFolders(tree);

        const availablePaths = new Set(Object.keys(folderSources));
        files = files.filter((file) => availablePaths.has(file.path));
        if (files.length === 0) {
            activeIndex = -1;
            renderTabs();
            showEmptyState();
        } else {
            if (activeIndex >= files.length) {
                activeIndex = files.length - 1;
            }
            renderTabs();
            if (activeIndex >= 0) {
                refreshOpenTabs().then(() => {
                    if (activeIndex >= 0 && activeIndex < files.length) {
                        renderContent(files[activeIndex].content);
                        updateExplorerHighlight(files[activeIndex].path);
                    } else {
                        showEmptyState();
                    }
                });
            }
        }

        renderFolderTree();
        saveSession();
    }

    async function refreshOpenTabs() {
        for (const file of files) {
            const source = folderSources[file.path];
            if (!source) {
                continue;
            }
            file.content = await readSourceContent(source);
        }
        renderTabs();
    }

    function buildTreeFromFileList(fileList) {
        const root = createEmptyTree();
        const sources = {};

        for (const file of fileList) {
            const path = normalizePath(file.webkitRelativePath || file.name);
            const parts = path.split('/');
            const relativeParts = parts.length > 1 ? parts.slice(1) : parts;
            addFileToTree(root, relativeParts, path);
            sources[path] = { type: 'file', file };
        }

        sortTree(root);
        return { tree: root, sources };
    }

    async function scanDirectoryHandle(directoryHandle) {
        const sources = {};
        const tree = await scanDirectoryNode(directoryHandle, '', sources);
        sortTree(tree);
        return { tree, sources };
    }

    async function scanDirectoryNode(directoryHandle, basePath, sources) {
        const node = createEmptyTree();

        for await (const [name, handle] of directoryHandle.entries()) {
            const nextPath = basePath ? `${basePath}/${name}` : name;

            if (handle.kind === 'directory') {
                const childNode = await scanDirectoryNode(handle, nextPath, sources);
                if (childNode.files.length || childNode.folders.length) {
                    node.folders.push({
                        name,
                        folders: childNode.folders,
                        files: childNode.files
                    });
                }
                continue;
            }

            if (!isMarkdownFileName(name)) {
                continue;
            }

            node.files.push({ name, path: nextPath });
            sources[nextPath] = { type: 'handle', handle };
        }

        return node;
    }

    function addFileToTree(root, parts, fullPath) {
        let current = root;

        for (let i = 0; i < parts.length; i += 1) {
            const part = parts[i];
            const isFile = i === parts.length - 1;

            if (isFile) {
                current.files.push({ name: part, path: fullPath });
                return;
            }

            let nextFolder = current.folders.find((folder) => folder.name === part);
            if (!nextFolder) {
                nextFolder = { name: part, folders: [], files: [] };
                current.folders.push(nextFolder);
            }
            current = nextFolder;
        }
    }

    function sortTree(node) {
        node.folders.sort(compareByName);
        node.files.sort(compareByName);
        for (const folder of node.folders) {
            sortTree(folder);
        }
    }

    async function loadStandaloneFile(file) {
        const path = normalizePath(file.webkitRelativePath || file.name);
        const content = await readBlobContent(file);
        upsertFile({
            id: `${Date.now()}-${Math.random()}`,
            name: file.name,
            path,
            content
        }, true);
    }

    async function openFolderFile(path) {
        const source = folderSources[path];
        if (!source) {
            return;
        }

        const content = await readSourceContent(source);
        const name = path.split('/').pop();
        upsertFile({
            id: `${Date.now()}-${Math.random()}`,
            name,
            path,
            content
        }, true);
    }

    function upsertFile(fileData, activate) {
        const existingIndex = files.findIndex((file) => file.path === fileData.path);
        if (existingIndex !== -1) {
            files[existingIndex] = { ...files[existingIndex], ...fileData };
            renderTabs();
            if (activate) {
                setActiveTab(existingIndex);
            }
            saveSession();
            return;
        }

        files.push(fileData);
        renderTabs();
        if (activate) {
            setActiveTab(files.length - 1);
        }
        saveSession();
    }

    function renderTabs() {
        tabsContainer.innerHTML = '';
        files.forEach((file, index) => {
            const tab = document.createElement('div');
            tab.className = `tab ${index === activeIndex ? 'active' : ''}`;

            const label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = file.name;

            const closeBtn = document.createElement('span');
            closeBtn.className = 'tab-close';
            closeBtn.dataset.index = index;
            closeBtn.innerHTML = '&times;';

            tab.appendChild(label);
            tab.appendChild(closeBtn);

            tab.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tab-close')) {
                    setActiveTab(index);
                }
            });

            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(index);
            });

            tabsContainer.appendChild(tab);
        });
    }

    function setActiveTab(index) {
        if (index < 0 || index >= files.length) {
            activeIndex = -1;
            renderTabs();
            showEmptyState();
            return;
        }

        activeIndex = index;
        renderTabs();
        renderContent(files[index].content);

        if (folderMode) {
            updateExplorerHighlight(files[index].path);
        }

        saveSession();
    }

    function closeTab(index) {
        files.splice(index, 1);

        if (files.length === 0) {
            activeIndex = -1;
            renderTabs();
            showEmptyState();
            saveSession();
            return;
        }

        if (activeIndex > index) {
            activeIndex -= 1;
        } else if (activeIndex === index) {
            activeIndex = Math.max(0, index - 1);
        }

        setActiveTab(activeIndex);
        saveSession();
    }

    function renderContent(markdown) {
        emptyState.style.display = 'none';

        const existingBody = markdownContainer.querySelector('.markdown-body');
        if (existingBody) {
            existingBody.remove();
        }

        const markdownBody = document.createElement('div');
        markdownBody.className = 'markdown-body';
        markdownBody.innerHTML = marked.parse(markdown);
        markdownContainer.appendChild(markdownBody);

        markdownBody.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    function showEmptyState() {
        emptyState.style.display = 'flex';
        const existingBody = markdownContainer.querySelector('.markdown-body');
        if (existingBody) {
            existingBody.remove();
        }
    }

    function renderFolderTree() {
        explorerContent.innerHTML = '';

        for (const folder of folderStructure.folders) {
            explorerContent.appendChild(createFolderElement(folder, folder.name));
        }

        for (const file of folderStructure.files) {
            explorerContent.appendChild(createFileElement(file));
        }
    }

    function createFolderElement(folder, folderPath) {
        const container = document.createElement('div');
        const isExpanded = expandedFolders.has(folderPath);
        container.className = `file-tree-item folder-node ${isExpanded ? 'expanded' : ''}`;
        container.dataset.folderPath = folderPath;

        const header = document.createElement('div');
        header.className = 'file-tree-item-content folder-content';

        const arrow = document.createElement('span');
        arrow.className = `tree-arrow ${isExpanded ? 'is-expanded' : ''}`;

        const icon = document.createElement('span');
        icon.className = 'tree-icon folder-icon';

        const label = document.createElement('span');
        label.textContent = folder.name;

        header.appendChild(arrow);
        header.appendChild(icon);
        header.appendChild(label);

        header.addEventListener('click', (e) => {
            e.stopPropagation();
            container.classList.toggle('expanded');
            arrow.classList.toggle('is-expanded');
            if (container.classList.contains('expanded')) {
                expandedFolders.add(folderPath);
            } else {
                expandedFolders.delete(folderPath);
            }
        });

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'file-tree-children';

        for (const childFolder of folder.folders) {
            const childPath = `${folderPath}/${childFolder.name}`;
            childrenContainer.appendChild(createFolderElement(childFolder, childPath));
        }

        for (const file of folder.files) {
            childrenContainer.appendChild(createFileElement(file));
        }

        container.appendChild(header);
        container.appendChild(childrenContainer);
        return container;
    }

    function createFileElement(file) {
        const container = document.createElement('div');
        container.className = 'file-tree-item file-node';
        container.dataset.filePath = file.path;

        const content = document.createElement('div');
        content.className = 'file-tree-item-content';

        const spacer = document.createElement('span');
        spacer.className = 'tree-spacer';

        const icon = document.createElement('span');
        icon.className = 'tree-icon file-icon';

        const label = document.createElement('span');
        label.textContent = file.name;

        content.appendChild(spacer);
        content.appendChild(icon);
        content.appendChild(label);

        content.addEventListener('click', async () => {
            const fileIndex = files.findIndex((openFile) => openFile.path === file.path);
            if (fileIndex !== -1) {
                setActiveTab(fileIndex);
                return;
            }
            await openFolderFile(file.path);
        });

        container.appendChild(content);
        return container;
    }

    function updateExplorerHighlight(filePath) {
        explorerContent.querySelectorAll('.file-tree-item-content.active').forEach((element) => {
            element.classList.remove('active');
        });

        const fileElement = explorerContent.querySelector(`[data-file-path="${CSS.escape(filePath)}"] .file-tree-item-content`);
        if (fileElement) {
            fileElement.classList.add('active');
        }
    }

    async function readSourceContent(source) {
        if (source.type === 'handle') {
            const file = await source.handle.getFile();
            return readBlobContent(file);
        }
        return readBlobContent(source.file);
    }

    function readBlobContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    function saveSession() {
        try {
            const sessionData = {
                files,
                activeIndex
            };
            localStorage.setItem('mdViewerSession', JSON.stringify(sessionData));
        } catch (error) {
            console.warn('Session save failed', error);
        }
    }

    function restoreSession() {
        try {
            const saved = localStorage.getItem('mdViewerSession');
            if (!saved) {
                return;
            }

            const sessionData = JSON.parse(saved);
            if (!sessionData.files || !Array.isArray(sessionData.files)) {
                return;
            }

            files = sessionData.files;
            activeIndex = sessionData.activeIndex;

            if (files.length === 0) {
                return;
            }

            renderTabs();
            if (activeIndex >= 0 && activeIndex < files.length) {
                setActiveTab(activeIndex);
            } else {
                setActiveTab(0);
            }
        } catch (error) {
            console.error('Failed to restore session', error);
        }
    }
});
