document.addEventListener('DOMContentLoaded', () => {
    const openBtn = document.getElementById('openBtn');
    const openFolderBtn = document.getElementById('openFolderBtn');
    const closeFolderBtn = document.getElementById('closeFolderBtn');
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

    let files = []; // Array of { name: string, content: string, path: string (fake) }
    let activeIndex = -1;
    let folderMode = false;
    let folderStructure = {}; // Tree of folders containing markdown files
    let folderFiles = {}; // Map of file paths to File objects for lazy loading

    // Initialize Marked
    // marked.use({
    //     gfm: true,
    //     breaks: true
    // });

    // Load session
    restoreSession();

    // Minimize/Expand functionality
    minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        topBar.classList.add('collapsed');
    });

    topBar.addEventListener('click', (e) => {
        if (topBar.classList.contains('collapsed')) {
            topBar.classList.remove('collapsed');
        }
    });

    // Add mouse wheel scroll for tabs
    tabsContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        tabsContainer.scrollLeft += e.deltaY > 0 ? 50 : -50;
    });

    openBtn.addEventListener('click', () => {
        fileInput.click();
    });

    openFolderBtn.addEventListener('click', () => {
        folderInput.click();
    });

    closeFolderBtn.addEventListener('click', () => {
        exitFolderMode();
    });

    fileInput.addEventListener('change', (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length > 0) {
            selectedFiles.forEach(file => {
                readFile(file);
            });
            // Reset input so same file can be selected again if needed
            fileInput.value = '';
        }
    });

    folderInput.addEventListener('change', (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length > 0) {
            enterFolderMode(selectedFiles);
            folderInput.value = '';
        }
    });

    function readFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const newFile = {
                name: file.name,
                content: content,
                id: Date.now() + Math.random().toString(), // Unique ID
                path: file.webkitRelativePath || file.name
            };
            
            // Check if file with same name already exists (simple check)
            const existingIndex = files.findIndex(f => f.name === newFile.name);
            if (existingIndex !== -1) {
                // Update content and switch to it
                files[existingIndex].content = content;
                setActiveTab(existingIndex);
            } else {
                files.push(newFile);
                renderTabs();
                setActiveTab(files.length - 1);
            }
            saveSession();
        };
        reader.readAsText(file);
    }

    function renderTabs() {
        tabsContainer.innerHTML = '';
        files.forEach((file, index) => {
            const tab = document.createElement('div');
            tab.className = `tab ${index === activeIndex ? 'active' : ''}`;
            tab.innerHTML = `
                <span>${file.name}</span>
                <span class="tab-close" data-index="${index}">&times;</span>
            `;
            
            tab.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tab-close')) {
                    setActiveTab(index);
                }
            });

            const closeBtn = tab.querySelector('.tab-close');
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
        
        // If in folder mode, highlight the active file in explorer
        if (folderMode) {
            updateExplorerHighlight(files[index].path);
        }
        
        saveSession();
    }

    function closeTab(index) {
        files.splice(index, 1);
        if (files.length === 0) {
            activeIndex = -1;
        } else if (activeIndex >= index) {
            activeIndex = Math.max(0, activeIndex - 1);
        }
        
        if (files.length > 0) {
            setActiveTab(activeIndex);
        } else {
            renderTabs();
            showEmptyState();
        }
        saveSession();
    }

    function renderContent(markdown) {
        // Hide empty state
        emptyState.style.display = 'none';
        
        // Remove existing markdown body if any
        const existingBody = markdownContainer.querySelector('.markdown-body');
        if (existingBody) {
            existingBody.remove();
        }

        const markdownBody = document.createElement('div');
        markdownBody.className = 'markdown-body';
        
        // Parse markdown
        markdownBody.innerHTML = marked.parse(markdown);
        
        markdownContainer.appendChild(markdownBody);

        // Apply syntax highlighting
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

    function enterFolderMode(selectedFiles) {
        // Extract folder structure with only markdown files
        const mdFiles = selectedFiles.filter(f => 
            f.name.toLowerCase().endsWith('.md') || 
            f.name.toLowerCase().endsWith('.markdown')
        );

        if (mdFiles.length === 0) {
            alert('No markdown files found in the selected folder.');
            return;
        }

        // Build folder tree structure
        folderStructure = buildFolderTree(mdFiles);
        
        // Store file references for lazy loading
        folderFiles = {};
        mdFiles.forEach(file => {
            folderFiles[file.webkitRelativePath] = file;
        });
        
        // Get folder name from first file path
        const firstPath = mdFiles[0].webkitRelativePath;
        const folderName = firstPath.split('/')[0];
        folderNameDisplay.textContent = folderName;

        // Clear files but don't load them
        files = [];
        activeIndex = -1;

        // Enable folder mode
        folderMode = true;
        openFolderBtn.style.display = 'none';
        closeFolderBtn.style.display = 'inline-block';
        explorerPanel.style.display = 'flex';
        contentArea.style.display = 'flex';

        // Show empty state on left side
        showEmptyState();
        renderTabs();
        
        // Render the folder tree
        renderFolderTree();
    }

    function exitFolderMode() {
        folderMode = false;
        folderStructure = {};
        files = [];
        activeIndex = -1;
        
        openFolderBtn.style.display = 'inline-block';
        closeFolderBtn.style.display = 'none';
        explorerPanel.style.display = 'none';
        contentArea.style.display = 'flex';
        
        showEmptyState();
        renderTabs();
        saveSession();
    }

    function buildFolderTree(mdFiles) {
        const tree = {};

        mdFiles.forEach(file => {
            const pathParts = file.webkitRelativePath.split('/');
            let current = tree;

            for (let i = 0; i < pathParts.length; i++) {
                const part = pathParts[i];
                if (i === pathParts.length - 1) {
                    // This is the file
                    if (!current.files) current.files = [];
                    current.files.push({
                        name: part,
                        path: file.webkitRelativePath,
                        file: file
                    });
                } else {
                    // This is a folder
                    if (!current.folders) current.folders = {};
                    if (!current.folders[part]) {
                        current.folders[part] = {};
                    }
                    current = current.folders[part];
                }
            }
        });

        return tree;
    }

    function renderFolderTree() {
        explorerContent.innerHTML = '';
        
        // Render root folders
        if (folderStructure.folders) {
            Object.keys(folderStructure.folders).sort().forEach(folderName => {
                const folderNode = createFolderElement(folderName, folderStructure.folders[folderName], [folderName]);
                explorerContent.appendChild(folderNode);
            });
        }

        // Render root files
        if (folderStructure.files) {
            folderStructure.files.forEach(fileObj => {
                const fileNode = createFileElement(fileObj, ['']);
                explorerContent.appendChild(fileNode);
            });
        }
    }

    function createFolderElement(folderName, folderObj, path) {
        const container = document.createElement('div');
        container.className = 'file-tree-item expanded';

        const header = document.createElement('div');
        header.className = 'file-tree-item-content';
        
        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow expanded';
        
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = '📁';
        
        const label = document.createElement('span');
        label.textContent = folderName;

        header.appendChild(arrow);
        header.appendChild(icon);
        header.appendChild(label);

        header.addEventListener('click', (e) => {
            e.stopPropagation();
            container.classList.toggle('expanded');
        });

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'file-tree-children';

        // Add subfolders
        if (folderObj.folders) {
            Object.keys(folderObj.folders).sort().forEach(subFolderName => {
                const subFolderNode = createFolderElement(subFolderName, folderObj.folders[subFolderName], [...path, subFolderName]);
                childrenContainer.appendChild(subFolderNode);
            });
        }

        // Add files
        if (folderObj.files) {
            folderObj.files.forEach(fileObj => {
                const fileNode = createFileElement(fileObj, path);
                childrenContainer.appendChild(fileNode);
            });
        }

        container.appendChild(header);
        container.appendChild(childrenContainer);

        return container;
    }

    function createFileElement(fileObj, path) {
        const container = document.createElement('div');
        container.className = 'file-tree-item';

        const content = document.createElement('div');
        content.className = 'file-tree-item-content';
        
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = '📄';
        
        const label = document.createElement('span');
        label.textContent = fileObj.name;

        content.appendChild(icon);
        content.appendChild(label);

        content.addEventListener('click', () => {
            // Check if file is already loaded
            const fileIndex = files.findIndex(f => f.path === fileObj.path);
            if (fileIndex !== -1) {
                setActiveTab(fileIndex);
            } else {
                // Load file on demand
                if (folderFiles[fileObj.path]) {
                    readFile(folderFiles[fileObj.path]);
                }
            }
        });

        container.appendChild(content);
        container.dataset.filePath = fileObj.path;

        return container;
    }

    function updateExplorerHighlight(filePath) {
        // Remove previous highlights
        explorerContent.querySelectorAll('.file-tree-item-content.active').forEach(el => {
            el.classList.remove('active');
        });

        // Add highlight to current file
        const fileElement = explorerContent.querySelector(`[data-file-path="${filePath}"] .file-tree-item-content`);
        if (fileElement) {
            fileElement.classList.add('active');
        }
    }

    function saveSession() {
        // We can't save full file paths in browser due to security, 
        // so we'll just save the content and names to localStorage.
        // Limit size to avoid quota errors.
        try {
            const sessionData = {
                files: files,
                activeIndex: activeIndex,
                folderMode: folderMode
            };
            localStorage.setItem('mdViewerSession', JSON.stringify(sessionData));
        } catch (e) {
            console.warn('Session save failed (likely quota exceeded)', e);
        }
    }

    function restoreSession() {
        try {
            const saved = localStorage.getItem('mdViewerSession');
            if (saved) {
                const sessionData = JSON.parse(saved);
                if (sessionData.files && Array.isArray(sessionData.files)) {
                    files = sessionData.files;
                    activeIndex = sessionData.activeIndex;
                    
                    if (files.length > 0) {
                        renderTabs();
                        if (activeIndex >= 0 && activeIndex < files.length) {
                            setActiveTab(activeIndex);
                        } else {
                            setActiveTab(0);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Failed to restore session', e);
        }
    }
});
