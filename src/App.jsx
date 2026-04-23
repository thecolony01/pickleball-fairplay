import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SKILL_TIERS = { "beginner": 1, "high beginner": 2, "intermediate": 3, "advanced intermediate": 4, "advanced": 5 };
const SKILL_COLORS = {
  "beginner": { bg: '#dcfce7', text: '#166534' },
  "high beginner": { bg: '#cffafe', text: '#155e75' },
  "intermediate": { bg: '#e0e7ff', text: '#3730a3' },
  "advanced intermediate": { bg: '#f3e8ff', text: '#6b21a8' },
  "advanced": { bg: '#ffe4e6', text: '#9f1239' }
};

const TOLERANCE_EXPANSION_MS = 10000; 
const MAX_WAIT_TIME_MS = 25000;       
const DUO_STICKINESS = 0.60; 

const playCallSound = () => {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 1);
  } catch (e) {
    console.log("Audio blocked until interaction.");
  }
};

const extractNextMatch = (queueCopy, currentTime) => {
  const availablePlayers = queueCopy.filter(p => !p.isResting);
  availablePlayers.sort((a, b) => {
    if (a.games === b.games) return a.tieBreakerRoll - b.tieBreakerRoll;
    return a.games - b.games;
  });

  for (let i = 0; i < availablePlayers.length; i++) {
    const seedPlayer = availablePlayers[i];
    let draftedPlayers = [seedPlayer];
    let isPlayingAsDuo = false;

    if (seedPlayer.partnerId) {
      const partner = availablePlayers.find(p => p.id === seedPlayer.partnerId);
      if (partner && seedPlayer.duoStickRoll <= DUO_STICKINESS) {
        draftedPlayers.push(partner);
        isPlayingAsDuo = true;
      }
    }

    let targetAverageSkill;
    if (isPlayingAsDuo) {
      const s1 = SKILL_TIERS[draftedPlayers[0].skill];
      const s2 = SKILL_TIERS[draftedPlayers[1].skill];
      if (seedPlayer.duoStyleRoll < 0.25) targetAverageSkill = Math.max(s1, s2);
      else if (seedPlayer.duoStyleRoll < 0.50) targetAverageSkill = Math.min(s1, s2);
      else targetAverageSkill = (s1 + s2) / 2;
    } else {
      const draftSkillSum = draftedPlayers.reduce((sum, p) => sum + SKILL_TIERS[p.skill], 0);
      targetAverageSkill = draftSkillSum / draftedPlayers.length; 
    }

    const waitTimeMs = currentTime - seedPlayer.queueEntryTime;
    const isStarving = waitTimeMs >= MAX_WAIT_TIME_MS;
    let currentTolerance = Math.min(2 + Math.floor(waitTimeMs / TOLERANCE_EXPANSION_MS), 4); 

    const remainingQueue = availablePlayers.filter(p => !draftedPlayers.some(d => d.id === p.id));
    let eligibleFillers = remainingQueue.filter(p => isStarving || Math.abs(SKILL_TIERS[p.skill] - targetAverageSkill) <= currentTolerance);

    const spotsToFill = 4 - draftedPlayers.length;
    if (eligibleFillers.length >= spotsToFill) {
      let fills = [];
      for (let fillPlayer of eligibleFillers) {
         if (fills.length === spotsToFill) break;
         if (fillPlayer.partnerId) {
             const partner = eligibleFillers.find(p => p.id === fillPlayer.partnerId);
             if (partner && (spotsToFill - fills.length >= 2) && fillPlayer.duoStickRoll <= DUO_STICKINESS) {
                 fills.push(fillPlayer, partner);
             } else fills.push(fillPlayer);
         } else fills.push(fillPlayer);
      }

      if (fills.length === spotsToFill) {
          const match = [...draftedPlayers, ...fills];
          const matchIds = match.map(p => p.id);
          return { match: match, remainingQueue: queueCopy.filter(p => !matchIds.includes(p.id)) };
      }
    }
  }
  return null; 
};

export default function PickleballApp() {
  const [viewMode, setViewMode] = useState('admin'); 
  const [courtCount, setCourtCount] = useState(3); 
  const [activeCourts, setActiveCourts] = useState({});
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [queue, setQueue] = useState([]); 
  
  const [newName, setNewName] = useState('');
  const [newSkill, setNewSkill] = useState('intermediate');
  const [flashingCourt, setFlashingCourt] = useState(null);

  // NEW: State to track who we are currently trying to link
  const [linkingPlayerId, setLinkingPlayerId] = useState(null);

  const channelRef = useRef(null);

  useEffect(() => {
    channelRef.current = new BroadcastChannel('fairplay_queue_sync');
    channelRef.current.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'STATE_UPDATE') {
        setQueue(data.queue);
        setActiveCourts(data.activeCourts);
        setCourtCount(data.courtCount);
        if (data.flashingCourt) {
          playCallSound();
          setFlashingCourt(data.flashingCourt);
          setTimeout(() => setFlashingCourt(null), 4000);
        }
      }
    };
    return () => channelRef.current.close();
  }, []);

  const updateAndBroadcast = (newQueue, newCourts, newCount, flashId = null) => {
    setQueue(newQueue);
    setActiveCourts(newCourts);
    setCourtCount(newCount);
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'STATE_UPDATE', queue: newQueue, activeCourts: newCourts, courtCount: newCount, flashingCourt: flashId
      });
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleAddPlayer = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    
    const now = Date.now();
    const newQueue = [...queue, {
      id: now.toString(),
      name: newName, skill: newSkill, games: 0,
      originalJoinTimeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
      queueEntryTime: now, 
      partnerId: null, isResting: false, 
      tieBreakerRoll: Math.random(), duoStickRoll: Math.random(), duoStyleRoll: Math.random()
    }];
    setNewName('');
    updateAndBroadcast(newQueue, activeCourts, courtCount);
  };

  const handleRemovePlayer = (playerId) => {
    // If we delete a player, we must also nullify their partner's link!
    const newQueue = queue.filter(p => p.id !== playerId).map(p => {
      if (p.partnerId === playerId) return { ...p, partnerId: null };
      return p;
    });
    updateAndBroadcast(newQueue, activeCourts, courtCount);
    if (linkingPlayerId === playerId) setLinkingPlayerId(null);
  };

  const toggleRestStatus = (playerId) => {
    const newQueue = queue.map(p => p.id === playerId ? { ...p, isResting: true } : p);
    updateAndBroadcast(newQueue, activeCourts, courtCount);
  };

  // --- NEW DUO LINKING LOGIC ---
  const handleLinkToggle = (playerId) => {
    const targetPlayer = queue.find(p => p.id === playerId);

    // Scenario 1: They already have a partner -> UNLINK THEM
    if (targetPlayer.partnerId) {
      const newQueue = queue.map(p => {
        if (p.id === playerId || p.id === targetPlayer.partnerId) {
          return { ...p, partnerId: null };
        }
        return p;
      });
      updateAndBroadcast(newQueue, activeCourts, courtCount);
      if (linkingPlayerId === playerId) setLinkingPlayerId(null);
      return;
    }

    // Scenario 2: We aren't linking anyone yet -> START LINKING
    if (!linkingPlayerId) {
      setLinkingPlayerId(playerId);
      return;
    }

    // Scenario 3: We clicked the same person again -> CANCEL LINKING
    if (linkingPlayerId === playerId) {
      setLinkingPlayerId(null);
      return;
    }

    // Scenario 4: We clicked a second person -> CREATE THE DUO!
    const newQueue = queue.map(p => {
      if (p.id === linkingPlayerId) return { ...p, partnerId: playerId };
      if (p.id === playerId) return { ...p, partnerId: linkingPlayerId };
      return p;
    });
    updateAndBroadcast(newQueue, activeCourts, courtCount);
    setLinkingPlayerId(null);
  };

  const changeCourtCount = (modifier) => {
    const newCount = Math.max(1, courtCount + modifier);
    updateAndBroadcast(queue, activeCourts, newCount);
  };

  let simulatedQueue = [...queue];
  const predictedMatches = [];
  const availableCourtCount = courtCount - Object.values(activeCourts).filter(c => c && c.isRented).length;
  for (let i = 0; i < Math.max(1, availableCourtCount); i++) { 
    const prediction = extractNextMatch(simulatedQueue, currentTime);
    if (prediction) {
      predictedMatches.push(prediction.match);
      simulatedQueue = prediction.remainingQueue; 
    }
  }

  const handleEndGame = (courtId) => {
    const courtData = activeCourts[courtId];
    const finishedPlayers = courtData && courtData.players ? courtData.players : [];
    
    const updatedPlayers = finishedPlayers.map(p => ({ 
      ...p, games: p.games + 1, queueEntryTime: Date.now(), 
      tieBreakerRoll: Math.random(), duoStickRoll: Math.random(), duoStyleRoll: Math.random() 
    }));
    
    const nextEvent = extractNextMatch([...queue, ...updatedPlayers], Date.now());

    if (nextEvent) {
      const clearedQueue = nextEvent.remainingQueue.map(p => ({ ...p, isResting: false }));
      const newCourts = { ...activeCourts, [courtId]: { players: nextEvent.match, startTime: Date.now() } };
      updateAndBroadcast(clearedQueue, newCourts, courtCount, courtId);
      playCallSound();
      setFlashingCourt(courtId);
      setTimeout(() => setFlashingCourt(null), 4000);
    } else {
      const clearedQueue = [...queue, ...updatedPlayers].map(p => ({ ...p, isResting: false }));
      const newCourts = { ...activeCourts, [courtId]: null };
      updateAndBroadcast(clearedQueue, newCourts, courtCount);
    }
  };

  const toggleRentCourt = (courtId) => {
    const currentCourt = activeCourts[courtId];
    let updatedQueue = [...queue];

    if (currentCourt && currentCourt.isRented) {
      const nextEvent = extractNextMatch(updatedQueue, Date.now());
      if (nextEvent) {
        const clearedQueue = nextEvent.remainingQueue.map(p => ({ ...p, isResting: false }));
        const newCourts = { ...activeCourts, [courtId]: { players: nextEvent.match, startTime: Date.now() } };
        updateAndBroadcast(clearedQueue, newCourts, courtCount, courtId);
        playCallSound();
        setFlashingCourt(courtId);
        setTimeout(() => setFlashingCourt(null), 4000);
      } else {
        const clearedQueue = updatedQueue.map(p => ({ ...p, isResting: false }));
        const newCourts = { ...activeCourts, [courtId]: null };
        updateAndBroadcast(clearedQueue, newCourts, courtCount);
      }
    } else {
      if (currentCourt && currentCourt.players) {
        const updatedPlayers = currentCourt.players.map(p => ({ 
          ...p, games: p.games + 1, queueEntryTime: Date.now(), 
          tieBreakerRoll: Math.random(), duoStickRoll: Math.random(), duoStyleRoll: Math.random() 
        }));
        updatedQueue = [...updatedQueue, ...updatedPlayers];
      }
      const newCourts = { ...activeCourts, [courtId]: { isRented: true, startTime: Date.now() } };
      updateAndBroadcast(updatedQueue, newCourts, courtCount);
    }
  };

  const formatTime = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
  };

  const isAdmin = viewMode === 'admin';

  return (
    <div style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box', backgroundColor: '#0f172a', padding: '20px 40px', fontFamily: '"Inter", system-ui, sans-serif', color: '#f8fafc' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '2px solid #1e293b', paddingBottom: '15px' }}>
        <h1 style={{ fontSize: '36px', fontWeight: '900', margin: 0, display: 'flex', alignItems: 'center', gap: '15px', color: '#38bdf8' }}>
          <span>🎾</span> FairPlay System
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
          <div style={{ display: 'flex', backgroundColor: '#1e293b', padding: '4px', borderRadius: '8px', border: '1px solid #334155' }}>
            <button onClick={() => setViewMode('admin')} style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', backgroundColor: isAdmin ? '#3b82f6' : 'transparent', color: isAdmin ? '#fff' : '#94a3b8', transition: '0.2s' }}>Admin Controls</button>
            <button onClick={() => setViewMode('tv')} style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', backgroundColor: !isAdmin ? '#10b981' : 'transparent', color: !isAdmin ? '#fff' : '#94a3b8', transition: '0.2s' }}>TV Display Only</button>
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => changeCourtCount(1)} style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>+ Add Court</button>
              <button onClick={() => changeCourtCount(-1)} style={{ padding: '8px 16px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>- Remove Court</button>
            </div>
          )}
          <div style={{ fontSize: '24px', fontWeight: '600', color: '#94a3b8', borderLeft: '2px solid #334155', paddingLeft: '20px' }}>
             {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {isAdmin && (
        <form onSubmit={handleAddPlayer} style={{ display: 'flex', gap: '15px', padding: '20px', backgroundColor: '#1e293b', borderRadius: '12px', border: '1px solid #334155', marginBottom: '30px', width: '100%', boxSizing: 'border-box' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Enter player name..." style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff', fontSize: '15px', outline: 'none' }} />
          <select value={newSkill} onChange={e => setNewSkill(e.target.value)} style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #475569', backgroundColor: '#0f172a', color: '#fff', fontSize: '15px', cursor: 'pointer', outline: 'none', minWidth: '200px' }}>
            {Object.keys(SKILL_TIERS).map(skill => <option key={skill} value={skill}>{skill.toUpperCase()}</option>)}
          </select>
          <button type="submit" style={{ padding: '12px 24px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', minWidth: '150px' }}>Add to Queue</button>
        </form>
      )}

      <div style={{ display: 'flex', gap: '40px', width: '100%', alignItems: 'flex-start' }}>
        
        {/* LEFT COLUMN */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '30px' }}>
          
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '15px' }}>🟢 Playing Now</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
              {Array.from({ length: courtCount }).map((_, i) => {
                const courtId = `Court ${i + 1}`;
                const courtData = activeCourts[courtId];
                const isRented = courtData && courtData.isRented;
                const isFull = courtData && courtData.players && courtData.players.length === 4;
                const isFlashing = flashingCourt === courtId;

                let borderColor = '#475569'; 
                if (isFull) borderColor = '#10b981'; 
                if (isRented) borderColor = '#a855f7'; 

                return (
                  <motion.div key={courtId} animate={isFlashing ? { boxShadow: ["0px 0px 0px rgba(16, 185, 129, 0)", "0px 0px 50px rgba(16, 185, 129, 0.8)", "0px 0px 0px rgba(16, 185, 129, 0)"], borderColor: ["#475569", "#10b981", "#475569"] } : {}} transition={{ duration: 1.2, repeat: 3 }} 
                    style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '16px', border: isFull || isRented ? `2px solid ${borderColor}` : `2px dashed ${borderColor}` }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                      <h3 style={{ margin: 0, fontSize: '22px', fontWeight: 'bold' }}>
                        {courtId} {isFlashing && <span style={{ color: '#10b981', fontSize: '16px', marginLeft: '10px' }}>NOW CALLING!</span>}
                      </h3>
                      {isRented ? (
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#a855f7', backgroundColor: '#a855f720', padding: '4px 8px', borderRadius: '6px' }}>👑 RESERVED</span>
                      ) : (
                        isFull && <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>⏱️ {formatTime(currentTime - courtData.startTime)}</span>
                      )}
                    </div>
                    
                    <div style={{ minHeight: '210px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {isRented ? (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#a855f7', gap: '10px' }}>
                          <span style={{ fontSize: '40px' }}>🔒</span>
                          <span style={{ fontSize: '18px', fontWeight: 'bold' }}>Private Rental in Progress</span>
                          <span style={{ fontSize: '14px', color: '#94a3b8' }}>{formatTime(currentTime - courtData.startTime)}</span>
                        </div>
                      ) : isFull ? (
                        courtData.players.map(p => (
                         <div key={p.id} style={{ padding: '10px 14px', backgroundColor: '#0f172a', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                             <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                               <span style={{ fontSize: '16px', fontWeight: '600' }}>{p.name} {p.partnerId && '🔗'}</span>
                               <span style={{ fontSize: '11px', color: '#94a3b8', backgroundColor: '#1e293b', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>🎮 {p.games}</span>
                             </div>
                             <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>Arrived: {p.originalJoinTimeStr}</span>
                           </div>
                           <span style={{ color: SKILL_COLORS[p.skill].bg, fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase' }}>{p.skill}</span>
                         </div>
                        ))
                      ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '20px' }}>OPEN</div>
                      )}
                    </div>
                    
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                        {isRented ? (
                          <button onClick={() => toggleRentCourt(courtId)} style={{ flex: 1, padding: '10px', backgroundColor: '#a855f7', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>End Rental & Open Court</button>
                        ) : (
                          <>
                            <button onClick={() => handleEndGame(courtId)} style={{ flex: 2, padding: '10px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>{isFull ? 'Force End Game' : 'Auto-Fill Court'}</button>
                            <button onClick={() => toggleRentCourt(courtId)} style={{ flex: 1, padding: '10px', backgroundColor: 'transparent', color: '#a855f7', border: '1px solid #a855f7', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Rent</button>
                          </>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '15px' }}>🟡 Up Next (On Deck)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
              <AnimatePresence>
                {predictedMatches.map((matchPlayers, index) => (
                  <motion.div key={`predict-${matchPlayers[0].id}`} layout initial={{ opacity: 0, x: -50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.8 }} style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '16px', borderLeft: '6px solid #f59e0b' }}>
                    <h3 style={{ margin: '0 0 15px 0', fontSize: '20px', color: '#f59e0b' }}>Next Match {index + 1}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {matchPlayers.map(p => (
                         <div key={`deck-${p.id}`} style={{ padding: '8px 12px', backgroundColor: '#334155', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                             <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                               <span style={{ fontSize: '16px', fontWeight: '500' }}>{p.name} {p.partnerId && '🔗'}</span>
                               <span style={{ fontSize: '11px', color: '#94a3b8', backgroundColor: '#1e293b', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>🎮 {p.games}</span>
                             </div>
                             <span style={{ fontSize: '11px', color: '#94a3b8' }}>Arrived: {p.originalJoinTimeStr}</span>
                           </div>
                           
                           <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                             <span style={{ color: '#94a3b8', fontSize: '12px', textTransform: 'uppercase' }}>{p.skill}</span>
                             {isAdmin && (
                               <button 
                                 onClick={() => toggleRestStatus(p.id)} 
                                 title="Snooze this match (Take a break)" 
                                 style={{ background: '#1e293b', border: '1px solid #475569', color: '#f8fafc', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                                 ⏸️ SNOOZE
                               </button>
                             )}
                           </div>
                         </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {predictedMatches.length === 0 && <div style={{ color: '#475569', fontSize: '18px', padding: '20px' }}>Not enough players ready.</div>}
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: Standby List */}
        <div style={{ width: '400px', flexShrink: 0, backgroundColor: '#1e293b', borderRadius: '16px', padding: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '15px', display: 'flex', justifyContent: 'space-between' }}>
            Standby List <span style={{ backgroundColor: '#334155', padding: '4px 12px', borderRadius: '20px' }}>{simulatedQueue.length}</span>
          </h2>

          {/* NEW: The Link Mode Warning Banner */}
          {linkingPlayerId && isAdmin && (
            <div style={{ backgroundColor: '#38bdf820', color: '#38bdf8', padding: '10px', borderRadius: '8px', fontSize: '14px', marginBottom: '15px', textAlign: 'center', fontWeight: 'bold', border: '1px dashed #38bdf8' }}>
              Select a second player to link as a Duo...
              <button onClick={() => setLinkingPlayerId(null)} style={{ marginLeft: '10px', background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', textDecoration: 'underline', fontWeight: 'bold' }}>Cancel</button>
            </div>
          )}
          
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
            <AnimatePresence>
              {simulatedQueue.length === 0 && <div style={{ color: '#475569', textAlign: 'center', padding: '20px' }}>Queue is empty.</div>}
              
              {simulatedQueue.map((player) => {
                const waitMs = currentTime - player.queueEntryTime;
                const isStarving = waitMs >= MAX_WAIT_TIME_MS;
                const c = SKILL_COLORS[player.skill];
                const isBeingLinked = linkingPlayerId === player.id;
                
                return (
                  <motion.li key={player.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} 
                    style={{ 
                      backgroundColor: player.isResting ? '#0f172a' : '#1e293b', 
                      padding: '12px 16px', borderRadius: '8px', border: '1px solid #334155',
                      borderLeft: `4px solid ${isBeingLinked ? '#38bdf8' : (player.isResting ? '#475569' : (isStarving ? '#ef4444' : c.text))}`, 
                      opacity: player.isResting ? 0.6 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' 
                    }}>
                    
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong style={{ fontSize: '16px', color: isBeingLinked ? '#38bdf8' : (player.isResting ? '#94a3b8' : (isStarving ? '#ef4444' : '#f8fafc')), textDecoration: player.isResting ? 'line-through' : 'none' }}>
                        {player.name} {isStarving && !player.isResting && '🔥'}
                        {player.isResting && <span style={{fontSize: '12px', marginLeft: '6px', color: '#475569'}}>(Snoozing)</span>}
                      </strong>

                      {/* NEW: Explicitly show who they are linked with */}
                      {player.partnerId && (
                        <span style={{ fontSize: '11px', color: '#38bdf8', marginTop: '2px', fontWeight: 'bold' }}>
                          🔗 Duo with {queue.find(p => p.id === player.partnerId)?.name || 'Unknown'}
                        </span>
                      )}

                      <span style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                        Arrived: {player.originalJoinTimeStr} | Games: {player.games} | Wait: {formatTime(waitMs)}
                      </span>
                    </div>

                    {isAdmin ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        
                        {/* NEW: The Link / Unlink Button */}
                        <button 
                          onClick={() => handleLinkToggle(player.id)} 
                          title={player.partnerId ? "Unlink Duo" : (isBeingLinked ? "Cancel Linking" : "Link as Duo")} 
                          style={{ 
                            background: player.partnerId ? '#ef444420' : (isBeingLinked ? '#38bdf8' : '#334155'), 
                            color: player.partnerId ? '#ef4444' : '#fff', 
                            border: 'none', borderRadius: '4px', padding: '6px', cursor: 'pointer', fontSize: '14px' 
                          }}>
                          {player.partnerId ? '💔' : '🔗'}
                        </button>

                        <button onClick={() => handleRemovePlayer(player.id)} title="Remove Player entirely" style={{ background: '#ef444420', color: '#ef4444', border: 'none', borderRadius: '4px', padding: '6px', cursor: 'pointer', fontSize: '14px' }}>
                          ✖️
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: '11px', fontWeight: 'bold', backgroundColor: c.text, color: '#fff', padding: '4px 8px', borderRadius: '4px', textTransform: 'uppercase' }}>
                        {player.skill.slice(0, 3)} 
                      </span>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>

      </div>
    </div>
  );
}