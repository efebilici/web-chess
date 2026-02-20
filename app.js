/**
 * Web Chess - Game Controller
 */

class WebChess {
    constructor() {
        // Core state
        this.game = new Chess();
        this.boardEl = document.getElementById('chessboard');
        this.statusTextEl = document.getElementById('status-text');
        this.statusIndicatorEl = document.querySelector('.status-indicator');
        this.shareContainerEl = document.getElementById('share-container');

        // Settings
        this.playerColor = 'w';
        this.difficulty = 'medium';
        this.isBotThinking = false;

        // UI State
        this.selectedSquare = null;
        this.validMoves = [];
        this.hintMove = null;
        this.hintTimeout = null;
        this.lastMove = null;

        // Piece paths (Wikimedia Commons public domain SVGs)
        this.pieceImages = {
            'w-p': 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
            'w-n': 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
            'w-b': 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
            'w-r': 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
            'w-q': 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
            'w-k': 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
            'b-p': 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
            'b-n': 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
            'b-b': 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
            'b-r': 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
            'b-q': 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
            'b-k': 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg'
        };

        // Engine State
        this.engine = null;
        this.isEngineReady = false;
        this.pendingAction = null; // 'move' or 'hint'

        this.initStockfish();
        this.bindEvents();
        this.initBoard();
        this.updateBoard();
        this.updateStatus();
    }

    initStockfish() {
        // We load stockfish.js from a CDN using a Blob to avoid cross-origin worker issues
        const stockfishScript = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
Stockfish().then(function(sf) {
    sf.addMessageListener(function(msg) { postMessage(msg); });
    addEventListener('message', function(e) { sf.postMessage(e.data); });
});`;

        const blob = new Blob([stockfishScript], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);

        this.engine = new Worker(workerUrl);

        this.engine.onmessage = (event) => {
            const line = event.data;

            if (line === 'uciok') {
                this.isEngineReady = true;
                this.updateEngineDifficulty();
            } else if (line.startsWith('bestmove')) {
                const match = line.match(/^bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/);
                if (match) {
                    const from = match[1];
                    const to = match[2];
                    const promotion = match[3];

                    if (this.pendingAction === 'move') {
                        this.executeBotMove(from, to, promotion);
                    } else if (this.pendingAction === 'hint') {
                        this.showHint(from, to);
                    }
                }
                this.pendingAction = null;
            }
        };

        this.engine.postMessage('uci');
    }

    updateEngineDifficulty() {
        if (!this.isEngineReady) return;

        // Difficulty mappings
        let skillLevel = 5;
        let depth = 5;

        switch (this.difficulty) {
            case 'easy':
                skillLevel = 0;
                depth = 1;
                break;
            case 'medium':
                skillLevel = 5;
                depth = 5;
                break;
            case 'hard':
                skillLevel = 20;
                depth = 12;
                break;
        }

        this.engine.postMessage(`setoption name Skill Level value ${skillLevel}`);
        this.engineDepth = depth;
    }

    bindEvents() {
        // Side Selection
        document.querySelectorAll('#side-selector .btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this.game.history().length > 0) {
                    if (!confirm("Start a new game with this side?")) return;
                }
                document.querySelectorAll('#side-selector .btn').forEach(b => b.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                this.playerColor = target.dataset.value;
                this.startNewGame();
            });
        });

        // Difficulty Selection
        document.querySelectorAll('#difficulty-selector .btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('#difficulty-selector .btn').forEach(b => b.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                this.difficulty = target.dataset.value;
                this.updateEngineDifficulty();
            });
        });

        // Theme Selection
        document.getElementById('theme-selector').addEventListener('change', (e) => {
            document.body.setAttribute('data-theme', e.target.value);
        });

        // Action Buttons
        document.getElementById('new-game-btn').addEventListener('click', () => this.startNewGame());

        document.getElementById('hint-btn').addEventListener('click', () => {
            if (this.isBotThinking || this.game.game_over() || this.game.turn() !== this.playerColor) return;
            this.requestHint();
        });

        document.getElementById('share-twitter-btn').addEventListener('click', () => {
            const text = `I just beat Stockfish (${this.difficulty}) in Web Chess! ♟️🔥 Try it out: https://efebilici.github.io/web-chess/`;
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
        });
    }

    startNewGame() {
        this.game.reset();
        this.selectedSquare = null;
        this.validMoves = [];
        this.hintMove = null;
        if (this.hintTimeout) clearTimeout(this.hintTimeout);
        this.lastMove = null;
        this.shareContainerEl.classList.add('hidden');
        this.isBotThinking = false;
        this.pendingAction = null;

        if (this.isEngineReady) {
            this.engine.postMessage('ucinewgame');
        }

        this.updateBoard();
        this.updateStatus();

        if (this.playerColor === 'b' && this.game.turn() === 'w') {
            this.makeBotMove();
        }
    }

    // Convert algebraic notation (e2) to grid index (0-63) depending on turn view
    squareToIndex(sq) {
        const file = sq.charCodeAt(0) - 97; // a=0, h=7
        const rank = 8 - parseInt(sq[1]);   // 8=0, 1=7

        if (this.playerColor === 'b') {
            // Flip board for black
            return ((7 - rank) * 8) + (7 - file);
        }
        return (rank * 8) + file;
    }

    indexToSquare(index) {
        let fileIndex = index % 8;
        let rankIndex = Math.floor(index / 8);

        if (this.playerColor === 'b') {
            fileIndex = 7 - fileIndex;
            rankIndex = 7 - rankIndex;
        }

        const file = String.fromCharCode(97 + fileIndex);
        const rank = 8 - rankIndex;
        return `${file}${rank}`;
    }

    initBoard() {
        this.boardEl.innerHTML = '';
        for (let i = 0; i < 64; i++) {
            const square = document.createElement('div');

            // Calculate checkboard pattern
            const row = Math.floor(i / 8);
            const col = i % 8;
            const isLight = (row + col) % 2 === 0;

            square.className = `square ${isLight ? 'light' : 'dark'}`;
            square.dataset.index = i;

            // Click handler
            square.addEventListener('click', () => this.handleSquareClick(i));

            this.boardEl.appendChild(square);
        }
    }

    handleSquareClick(index) {
        if (this.isBotThinking || this.game.game_over()) return;
        if (this.game.turn() !== this.playerColor) return;

        const sq = this.indexToSquare(index);

        // If clicking a valid move target
        const move = this.validMoves.find(m => m.to === sq);
        if (move) {
            // Check for promotion (default to queen for now)
            if (move.flags.includes('p') || move.flags.includes('cp')) {
                move.promotion = 'q'; // Simple auto-queen promotion
            }

            this.makeMove(move);
            return;
        }

        // Selecting a piece
        const piece = this.game.get(sq);
        if (piece && piece.color === this.playerColor) {
            this.selectedSquare = sq;
            this.validMoves = this.game.moves({ square: sq, verbose: true });
        } else {
            this.selectedSquare = null;
            this.validMoves = [];
        }

        this.hintMove = null; // Clear hint on interaction
        this.updateBoard();
    }

    makeMove(moveObj) {
        const move = this.game.move(moveObj);
        if (move) {
            this.selectedSquare = null;
            this.validMoves = [];
            this.hintMove = null;
            this.lastMove = { from: move.from, to: move.to };

            this.updateBoard();
            this.updateStatus();

            if (!this.game.game_over()) {
                this.isBotThinking = true;
                this.updateStatus();
                // We use setTimeout to allow UI to render the user's move first
                setTimeout(() => this.makeBotMove(), 100);
            }
        }
    }

    makeBotMove() {
        if (!this.isEngineReady) return;

        this.pendingAction = 'move';
        this.engine.postMessage(`position fen ${this.game.fen()}`);
        this.engine.postMessage(`go depth ${this.engineDepth || 5}`);
    }

    executeBotMove(from, to, promotion) {
        const move = this.game.move({
            from: from,
            to: to,
            promotion: promotion || 'q'
        });

        if (move) {
            this.lastMove = { from: move.from, to: move.to };
            this.isBotThinking = false;
            this.updateBoard();
            this.updateStatus();
        }
    }

    requestHint() {
        if (!this.isEngineReady || this.isBotThinking) return;

        // Request a strong hint regardless of selected difficulty
        this.pendingAction = 'hint';
        this.statusTextEl.textContent = 'Calculating hint...';
        this.engine.postMessage(`position fen ${this.game.fen()}`);
        this.engine.postMessage(`go depth 12`); // deeper depth for hints
    }

    showHint(from, to) {
        this.hintMove = { from, to };
        this.updateStatus(); // reset status text
        this.updateBoard();

        // Auto-clear hint after 3 seconds if unused
        if (this.hintTimeout) clearTimeout(this.hintTimeout);
        this.hintTimeout = setTimeout(() => {
            if (this.hintMove && this.hintMove.from === from && this.hintMove.to === to) {
                this.hintMove = null;
                this.updateBoard();
            }
        }, 3000);
    }

    updateBoard() {
        const squares = this.boardEl.children;
        const currentBoard = this.game.board(); // 8x8 array

        // Clear all squares
        for (let i = 0; i < 64; i++) {
            const sqEl = squares[i];
            sqEl.innerHTML = '';
            sqEl.className = 'square ' + (sqEl.classList.contains('light') ? 'light' : 'dark');

            const sqName = this.indexToSquare(i);

            // Render pieces
            let fileIndex = sqName.charCodeAt(0) - 97;
            let rankIndex = 8 - parseInt(sqName[1]);
            const piece = currentBoard[rankIndex][fileIndex];

            if (piece) {
                const img = document.createElement('div');
                img.className = 'piece';
                const key = `${piece.color}-${piece.type}`;
                img.style.backgroundImage = `url(${this.pieceImages[key]})`;
                sqEl.appendChild(img);
            }

            // Apply highlights
            if (sqName === this.selectedSquare) {
                sqEl.classList.add('selected');
            }
            if (this.lastMove && (sqName === this.lastMove.from || sqName === this.lastMove.to)) {
                sqEl.classList.add('last-move');
            }
            if (this.hintMove && (sqName === this.hintMove.from || sqName === this.hintMove.to)) {
                sqEl.classList.add('hint');
            }

            const validMove = this.validMoves.find(m => m.to === sqName);
            if (validMove) {
                if (validMove.flags.includes('c') || validMove.flags.includes('e')) {
                    sqEl.classList.add('valid-capture');
                } else {
                    sqEl.classList.add('valid-move');
                }
            }
        }
    }

    updateStatus() {
        let status = '';
        const turnColor = this.game.turn() === 'w' ? 'White' : 'Black';

        if (this.game.in_checkmate()) {
            status = `Game over, ${turnColor} is in checkmate.`;
            // Check win condition
            if (this.game.turn() !== this.playerColor) {
                this.shareContainerEl.classList.remove('hidden');
            }
        } else if (this.game.in_draw()) {
            status = 'Game over, drawn position';
        } else {
            if (this.game.turn() === this.playerColor) {
                status = 'Your turn';
                this.statusIndicatorEl.classList.add('active');
            } else {
                status = 'Bot thinking...';
                this.statusIndicatorEl.classList.remove('active');
            }
            if (this.game.in_check()) {
                status += ` (${turnColor} is in check)`;
            }
        }

        this.statusTextEl.textContent = status;
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.gameController = new WebChess();
});
