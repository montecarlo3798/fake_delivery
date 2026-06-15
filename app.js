/* ==========================================
   DELIVERY DETOX - Core Logic Controller
   ========================================== */

// 1. STATE CONFIGURATION
let state = {
  savedMoney: 0,
  successCount: 0,
  streak: 0,
  lastSuccessDate: null,
  ordersToday: 0,
  lastOrderDate: null,
  history: [],
  currentOrder: null // Stores the details of the active mock delivery session
};

let foods = [];
let currentSelectedFood = null;

// Simulated delivery stages configuration
const DELIVERY_STAGES = [
  { id: 1, name: '사장님이 주문을 확인했습니다', duration: 30 },
  { id: 2, name: '조리중', duration: 45 },
  { id: 3, name: '배달원이 픽업했습니다', duration: 60 },
  { id: 4, name: '곧 도착합니다', duration: 30 }
];

let activeTimerId = null;
let currentStageIndex = 0;
let stageSecondsRemaining = 0;
let isFastMode = false;

// 2. CSV PARSING UTILITY
function parseCSV(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const list = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length === headers.length) {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = values[index];
      });
      list.push({
        id: parseInt(item.id),
        name: item.name,
        price: parseInt(item.price),
        image: 'assets/' + item.image,
        category: item.category
      });
    }
  }
  return list;
}

// 3. LOAD DATA & HANDLE CORS FALLBACK
async function fetchFoodData() {
  try {
    const response = await fetch('data/foods.csv');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const csvText = await response.text();
    foods = parseCSV(csvText);
    console.log('Loaded food list from foods.csv successfully.');
  } catch (error) {
    console.warn('CORS or fetch restriction detected. Falling back to embedded CSV content.', error);
    // Standard embedded CSV representation
    const fallbackCSV = `id,name,price,image,category
1,치킨,23000,food1.jpg,치킨
2,피자,28000,food2.jpg,피자
3,짜장면,9000,food3.jpg,중식
4,햄버거,12000,food4.jpg,패스트푸드
5,떡볶이,14000,food5.jpg,분식`;
    foods = parseCSV(fallbackCSV);
  }
}

// 4. LOCAL STORAGE OPERATIONS
function loadStateFromStorage() {
  const stored = localStorage.getItem('deliveryDetoxState');
  if (stored) {
    try {
      state = JSON.parse(stored);
      // Ensure arrays/properties exist
      state.history = state.history || [];
      state.ordersToday = state.ordersToday || 0;
    } catch (e) {
      console.error('Error parsing localStorage state:', e);
    }
  }
  validateDailyMetrics();
}

function saveStateToStorage() {
  localStorage.setItem('deliveryDetoxState', JSON.stringify(state));
}

// Validate dates to reset today's order count or calculate streaks
function validateDailyMetrics() {
  const todayStr = getLocalDateString(new Date());

  // Reset today's orders if new day
  if (state.lastOrderDate !== todayStr) {
    state.ordersToday = 0;
  }

  // Check if daily streak is broken
  if (state.lastSuccessDate) {
    const lastDate = parseLocalDate(state.lastSuccessDate);
    const today = parseLocalDate(todayStr);
    const diffTime = Math.abs(today - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // If more than 1 day gap since last success, streak resets
    if (diffDays > 1) {
      state.streak = 0;
    }
  } else {
    state.streak = 0;
  }
}

// Date helpers
function getLocalDateString(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
}

function parseLocalDate(dateStr) {
  const parts = dateStr.split('-');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// 5. VIEW TRANSITIONS
function showView(viewId) {
  document.querySelectorAll('.app-view').forEach(view => {
    view.classList.remove('active');
  });

  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
    // Scroll mobile container to top
    document.querySelector('.app-container').scrollTop = 0;
  }

  // Update Status Text in Header
  const headerStatus = document.getElementById('header-status');
  switch (viewId) {
    case 'view-home':
      headerStatus.innerText = '디톡스 대기 중';
      break;
    case 'view-menu':
      headerStatus.innerText = '음식 고르는 중';
      break;
    case 'view-order-success':
      headerStatus.innerText = '주문 완료';
      break;
    case 'view-delivery':
      headerStatus.innerText = '실시간 배달 중';
      break;
    case 'view-reward':
      headerStatus.innerText = '디톡스 성공! 🎉';
      break;
  }
}

// 6. DOM RENDERING & METRIC INITIALIZATION
function updateHomeStats() {
  validateDailyMetrics();
  document.getElementById('home-saved-money').innerText = state.savedMoney.toLocaleString() + '원';
  document.getElementById('home-streak').innerText = state.streak + '일';
  document.getElementById('home-today-orders').innerText = state.ordersToday + '회';
  document.getElementById('home-total-success').innerText = state.successCount + '회';
}

function renderCategories(items) {
  const tabsContainer = document.getElementById('category-tabs');
  // Get unique categories
  const categories = ['전체', ...new Set(items.map(item => item.category))];
  
  tabsContainer.innerHTML = '';
  categories.forEach((cat, idx) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${idx === 0 ? 'active' : ''}`;
    btn.innerText = cat;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterAndRenderFoods(cat, document.getElementById('food-search').value);
    });
    tabsContainer.appendChild(btn);
  });
}

function renderFoodsList(items) {
  const container = document.getElementById('food-list');
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<div class="no-results">검색 결과가 없습니다.</div>';
    return;
  }

  items.forEach(food => {
    const card = document.createElement('div');
    card.className = 'food-card';
    card.innerHTML = `
      <img src="${food.image}" alt="${food.name}" class="food-img" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%232b3547%22/><text x=%2250%25%22 y=%2255%25%22 font-size=%2230%22 text-anchor=%22middle%22>🍲</text></svg>'">
      <div class="food-details">
        <div class="food-meta">
          <span class="food-category">${food.category}</span>
          <h3 class="food-name">${food.name}</h3>
        </div>
        <div class="food-price">${food.price.toLocaleString()}원</div>
      </div>
      <div class="food-action" style="padding: 14px; display: flex; align-items: flex-end;">
        <button class="btn btn-primary btn-small btn-order" data-id="${food.id}">주문하기</button>
      </div>
    `;
    container.appendChild(card);
  });

  // Attach event listeners to buttons
  container.querySelectorAll('.btn-order').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const foodId = parseInt(e.target.getAttribute('data-id'));
      selectFoodItem(foodId);
    });
  });
}

function filterAndRenderFoods(category = '전체', query = '') {
  let filtered = foods;
  
  if (category !== '전체') {
    filtered = filtered.filter(f => f.category === category);
  }
  
  if (query.trim() !== '') {
    const lowercaseQuery = query.toLowerCase();
    filtered = filtered.filter(f => f.name.toLowerCase().includes(lowercaseQuery));
  }
  
  renderFoodsList(filtered);
}

function selectFoodItem(id) {
  currentSelectedFood = foods.find(f => f.id === id);
  if (!currentSelectedFood) return;

  // Immediately initialize the current active order details
  state.currentOrder = {
    foodId: currentSelectedFood.id,
    startTime: Date.now(),
    isFastMode: isFastMode
  };
  saveStateToStorage();

  // Populating order success page elements
  document.getElementById('success-menu-name').innerText = currentSelectedFood.name;
  document.getElementById('success-menu-price').innerText = currentSelectedFood.price.toLocaleString() + '원';

  showView('view-order-success');
}

// 7. REAL-TIME PROGRESS SIMULATOR & TIMERS
function startDeliverySimulation() {
  showView('view-delivery');
  runTimerTicks();
}

function runTimerTicks() {
  if (activeTimerId) clearInterval(activeTimerId);
  
  tick(); // Execute initial tick immediately
  activeTimerId = setInterval(tick, 1000);
}

function tick() {
  if (!state.currentOrder) {
    if (activeTimerId) {
      clearInterval(activeTimerId);
      activeTimerId = null;
    }
    return;
  }

  // Calculate elapsed seconds based on wall-clock differences
  const elapsedMs = Date.now() - state.currentOrder.startTime;
  let elapsedSeconds = elapsedMs / 1000;
  if (state.currentOrder.isFastMode) {
    elapsedSeconds *= 10; // 10x faster progress scaling
  }

  const totalDuration = DELIVERY_STAGES.reduce((sum, stage) => sum + stage.duration, 0);

  if (elapsedSeconds >= totalDuration) {
    // Delivery complete
    if (activeTimerId) {
      clearInterval(activeTimerId);
      activeTimerId = null;
    }
    finishDelivery();
  } else {
    // Identify current active stage and time remaining
    let accumulatedTime = 0;
    let stageIndex = 0;
    let remainingInStage = 0;

    for (let i = 0; i < DELIVERY_STAGES.length; i++) {
      const stageDuration = DELIVERY_STAGES[i].duration;
      if (elapsedSeconds < accumulatedTime + stageDuration) {
        stageIndex = i;
        remainingInStage = Math.ceil((accumulatedTime + stageDuration) - elapsedSeconds);
        break;
      }
      accumulatedTime += stageDuration;
    }

    currentStageIndex = stageIndex;
    stageSecondsRemaining = remainingInStage;
    setupStageUI(stageIndex, remainingInStage);
  }
}

function setupStageUI(index, remainingSeconds) {
  if (index >= DELIVERY_STAGES.length) return;
  const stage = DELIVERY_STAGES[index];
  
  document.getElementById('delivery-stage-text').innerText = stage.name;

  // Timeline UI Highlighting
  for (let i = 1; i <= 4; i++) {
    const element = document.getElementById(`step-${i}`);
    element.classList.remove('active', 'completed');
    if (i === stage.id) {
      element.classList.add('active');
    } else if (i < stage.id) {
      element.classList.add('completed');
    }
  }

  // Map Rider Animation Progress
  updateRiderPosition(index);
  updateTimerUI(index, remainingSeconds);
}

function updateRiderPosition(stageIdx) {
  const rider = document.getElementById('rider-icon');
  const positions = ['15%', '35%', '60%', '85%'];
  rider.style.left = positions[stageIdx];
}

function updateTimerUI(stageIdx, remainingSeconds) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  
  document.getElementById('timer-display').innerText = 
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const circle = document.getElementById('timer-progress');
  const maxDuration = DELIVERY_STAGES[stageIdx].duration;
  
  // 326.7 represents stroke-dasharray (r=52)
  const offset = 326.7 - (remainingSeconds / maxDuration) * 326.7;
  circle.style.strokeDashoffset = offset;
}

function finishDelivery() {
  // Update UI values for reward view
  document.getElementById('reward-saved-session').innerText = currentSelectedFood.price.toLocaleString() + '원';
  document.getElementById('reward-total-saved').innerText = (state.savedMoney + currentSelectedFood.price).toLocaleString() + '원';
  
  // Predict streak numbers on current success session
  const todayStr = getLocalDateString(new Date());
  let tempStreak = state.streak;
  if (state.lastSuccessDate !== todayStr) {
    if (!state.lastSuccessDate || state.lastSuccessDate === getLocalDateString(new Date(Date.now() - 86400000))) {
      tempStreak++;
    } else {
      tempStreak = 1;
    }
  }
  document.getElementById('reward-streak').innerText = tempStreak + '일';

  showView('view-reward');
}

// 8. PSYCHOLOGICAL SURVEY & FINAL WRAP
function handleSurveySubmission(e) {
  e.preventDefault();
  
  const selectedCrave = document.querySelector('input[name="crave"]:checked').value;
  const todayStr = getLocalDateString(new Date());

  // Apply actual state updates
  state.savedMoney += currentSelectedFood.price;
  state.successCount += 1;
  
  // Streak calculations
  if (state.lastSuccessDate !== todayStr) {
    if (state.lastSuccessDate === getLocalDateString(new Date(Date.now() - 86400000))) {
      state.streak += 1;
    } else {
      state.streak = 1;
    }
    state.lastSuccessDate = todayStr;
  }
  
  state.ordersToday += 1;
  state.lastOrderDate = todayStr;

  // Append history log
  state.history.push({
    date: todayStr,
    timestamp: new Date().toISOString(),
    foodId: currentSelectedFood.id,
    foodName: currentSelectedFood.name,
    price: currentSelectedFood.price,
    craveAnswer: selectedCrave
  });

  // Clear the active current order from the state
  state.currentOrder = null;

  // Persist and redirect
  saveStateToStorage();
  updateHomeStats();
  
  alert('디톡스 기록이 성공적으로 저장되었습니다! 멋진 성취입니다. 👍');
  
  // Reset selected item
  currentSelectedFood = null;
  
  // Reset survey radio inputs
  document.querySelectorAll('input[name="crave"]').forEach(el => el.checked = false);

  showView('view-home');
}

// 9. EVENT BINDING & INITIALIZATION
document.addEventListener('DOMContentLoaded', async () => {
  // Load local database representation
  await fetchFoodData();
  
  // Populate category buttons
  renderCategories(foods);
  renderFoodsList(foods);

  // Initialize state metrics
  loadStateFromStorage();
  updateHomeStats();

  // Check if there is an active order currently running
  checkActiveOrderOnLoad();

  // Navigation handlers
  document.getElementById('btn-start-detox').addEventListener('click', () => {
    showView('view-menu');
  });

  document.getElementById('btn-menu-back').addEventListener('click', () => {
    showView('view-home');
  });

  document.getElementById('btn-view-delivery').addEventListener('click', () => {
    startDeliverySimulation();
  });

  // Search input events
  document.getElementById('food-search').addEventListener('input', (e) => {
    const activeTab = document.querySelector('.tab-btn.active');
    const category = activeTab ? activeTab.innerText : '전체';
    filterAndRenderFoods(category, e.target.value);
  });

  // Fast-mode switch event handler with mid-delivery scaling adjustments
  document.getElementById('chk-fast-mode').addEventListener('change', (e) => {
    const newFastMode = e.target.checked;
    
    if (state.currentOrder) {
      // Calculate virtual elapsed seconds under previous speed to prevent jumps
      const elapsedMs = Date.now() - state.currentOrder.startTime;
      let elapsedSeconds = elapsedMs / 1000;
      if (state.currentOrder.isFastMode) {
        elapsedSeconds *= 10;
      }
      
      // Update state order configuration
      state.currentOrder.isFastMode = newFastMode;
      
      // Adjust start time so that progress remains smooth under the new scale
      const scaleFactor = newFastMode ? 10 : 1;
      state.currentOrder.startTime = Date.now() - (elapsedSeconds / scaleFactor) * 1000;
      saveStateToStorage();
    }
    
    isFastMode = newFastMode;
    tick(); // Recalculate ticks immediately
  });

  // Psychological Survey Form Submit Handler
  document.getElementById('survey-form').addEventListener('submit', handleSurveySubmission);

  // Focus and Tab visibility change handler to prevent background timer throttling issues
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.currentOrder && activeTimerId) {
      tick(); // Instantly update view offsets based on system clock
    }
  });

  // PWA Service Worker loading sequence (Safe wrapper for file:// usage)
  if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      console.log('ServiceWorker registration successful with scope: ', reg.scope);
    } catch (err) {
      console.warn('ServiceWorker registration failed: ', err);
    }
  }
});

// 10. RECOVERY CHECKS FOR PAGE REFRESH OR RE-LAUNCH
function checkActiveOrderOnLoad() {
  if (!state.currentOrder) {
    showView('view-home');
    return;
  }

  // Restore current food item from database mapping
  currentSelectedFood = foods.find(f => f.id === state.currentOrder.foodId);
  if (!currentSelectedFood) {
    state.currentOrder = null;
    saveStateToStorage();
    showView('view-home');
    return;
  }

  isFastMode = state.currentOrder.isFastMode;
  document.getElementById('chk-fast-mode').checked = isFastMode;

  // Determine elapsed scale seconds
  const elapsedMs = Date.now() - state.currentOrder.startTime;
  let elapsedSeconds = elapsedMs / 1000;
  if (isFastMode) {
    elapsedSeconds *= 10;
  }

  const totalDuration = DELIVERY_STAGES.reduce((sum, stage) => sum + stage.duration, 0);

  if (elapsedSeconds >= totalDuration) {
    // Delivery already completed during offline status, jump to survey
    finishDelivery();
  } else {
    // Simulation is still active, redirect back to progress map and run updates
    showView('view-delivery');
    runTimerTicks();
  }
}
