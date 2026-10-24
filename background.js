// เปิด side panel เมื่อคลิกไอคอน extension
// งานหลักทั้งหมดรันใน side panel เพราะ service worker ของ MV3 อาจถูกปิดระหว่างรอวิดีโอนาน ๆ
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
