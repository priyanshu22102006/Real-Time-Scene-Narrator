import React, { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useTheme } from '../App';

// ─── Animation variants ─────────────────────────────────────────────────────────
// Reduced y-offset (40→24) — less exaggerated entrance, still reads clearly
const fadeInUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

// Tighter stagger — 0.15→0.10 so the card cascade feels snappy, not slow
const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.10 } },
};

const featureCards = [
  {
    icon: '📷',
    title: 'Camera-to-Voice',
    description:
      'Converts live camera frames into natural spoken narration using AI vision models. Every 2 seconds, your surroundings are described in clear, concise audio.',
    gradient: 'from-indigo-500 to-purple-600',
    accent: 'rgba(99,102,241,0.12)',
  },
  {
    icon: '⚡',
    title: 'Ambient Mode',
    description:
      'Real-time object detection alerts you to moving obstacles — approaching cars, pedestrians, cyclists — with instant voice warnings before hazards reach you.',
    gradient: 'from-cyan-500 to-blue-600',
    accent: 'rgba(6,182,212,0.12)',
  },
  {
    icon: '📋',
    title: 'Task Mode',
    description:
      'Point your camera at any sign, document, or label. AI reads all visible text aloud and automatically identifies addresses for instant navigation.',
    gradient: 'from-violet-500 to-pink-600',
    accent: 'rgba(139,92,246,0.12)',
  },
  {
    icon: '🗺️',
    title: 'GPS Navigation',
    description:
      'Turn-by-turn voice guidance using open-source routing. Navigate to any destination with real-time position tracking and spoken distance updates.',
    gradient: 'from-emerald-500 to-teal-600',
    accent: 'rgba(16,185,129,0.12)',
  },
];

const steps = [
  { icon: '📷', label: 'Camera Feed', desc: 'Live video captured from device camera', color: '#6366f1' },
  { icon: '🔍', label: 'Image Analysis', desc: 'AI vision model processes each frame', color: '#06b6d4' },
  { icon: '✍️', label: 'Text Generation', desc: 'Scene described in natural language', color: '#8b5cf6' },
  { icon: '🔊', label: 'Speech Output', desc: 'Description spoken via Web Speech API', color: '#10b981' },
];

// ─── Waveform: consistent, purposeful bars instead of random pulse timings ──────
const WAVEFORM_HEIGHTS = [3, 5, 8, 6, 10, 7, 4, 9, 5, 3];

// ─── Navbar ─────────────────────────────────────────────────────────────────────
function Navbar() {
  const { isDark, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = [
    { href: '#features', label: 'Features' },
    { href: '#how-it-works', label: 'How It Works' },
    { href: '#cta', label: 'Get Started' },
  ];

  return (
    <header
      role="banner"
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/90 dark:bg-dark-900/90 backdrop-blur-md shadow-lg shadow-black/10'
          : 'bg-transparent'
      }`}
    >
      <nav
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <a href="#" className="flex items-center gap-2 group" aria-label="Real-Time Scene Narrator home">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-sm font-bold shadow-lg">
            👁
          </div>
          <span className="font-display font-bold text-lg text-gray-900 dark:text-white hidden sm:block">
            Scene Narrator
          </span>
        </a>

        {/* Desktop nav links */}
        <ul className="hidden md:flex items-center gap-6" role="list">
          {navLinks.map(({ href, label }) => (
            <li key={href}>
              <a
                href={href}
                className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 font-medium transition-colors duration-200 text-sm"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors duration-200"
          >
            {isDark ? '☀️' : '🌙'}
          </button>

          {/* CTA — single scale transform, no shadow stack */}
          <Link
            to="/app"
            className="hidden sm:inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2 rounded-full transition-all duration-200 hover:scale-[1.03] active:scale-[0.98]"
          >
            Try Live Demo
          </Link>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="md:hidden w-9 h-9 flex flex-col items-center justify-center gap-1.5"
          >
            <span className={`w-5 h-0.5 bg-current transition-all duration-200 ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`w-5 h-0.5 bg-current transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`w-5 h-0.5 bg-current transition-all duration-200 ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </nav>

      {/* Mobile menu — height transition communicates open/close clearly */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="md:hidden bg-white dark:bg-dark-900 border-t border-gray-200 dark:border-white/10 px-4 pb-4"
          >
            <ul className="flex flex-col gap-3 pt-4">
              {navLinks.map(({ href, label }) => (
                <li key={href}>
                  <a
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="block text-gray-700 dark:text-gray-300 font-medium py-2"
                  >
                    {label}
                  </a>
                </li>
              ))}
              <li>
                <Link
                  to="/app"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-center bg-primary-600 text-white font-semibold py-2.5 rounded-full"
                >
                  Try Live Demo
                </Link>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

// ─── Hero Section ───────────────────────────────────────────────────────────────
function HeroSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  // Reduced parallax range (150→80) — less motion-sickness risk, feels more controlled
  const y = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const opacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);

  return (
    <section
      ref={ref}
      id="hero"
      aria-label="Hero: Real-Time Scene Narrator"
      className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-animated"
    >
      {/* Background orbs — 3 orbs instead of 3+20 random particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent-500/15 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-800/10 rounded-full blur-3xl" />
      </div>

      {/* Hero content */}
      <motion.div
        style={{ y, opacity }}
        className="relative z-10 text-center px-4 sm:px-6 max-w-5xl mx-auto"
      >
        {/* Badge — single entrance, no scale bounce */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full text-sm font-medium text-accent-300 mb-8"
        >
          <span className="w-2 h-2 rounded-full bg-accent-400 animate-pulse" aria-hidden="true" />
          AI-Powered Accessibility Tool
        </motion.div>

        {/* Main heading */}
        <motion.h1
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
          className="font-display font-bold text-5xl sm:text-6xl lg:text-7xl xl:text-8xl text-white leading-tight mb-6"
        >
          See the World{' '}
          <span className="text-gradient">Through Sound</span>
        </motion.h1>

        {/* Subheading */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.3, ease: 'easeOut' }}
          className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed mb-10"
        >
          Real-Time Scene Narrator uses AI vision to instantly convert your camera feed into
          clear, spoken descriptions — empowering visually impaired users to navigate the
          world with confidence.
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45, ease: 'easeOut' }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            to="/app"
            className="group inline-flex items-center gap-3 bg-primary-600 hover:bg-primary-500 text-white font-bold text-lg px-8 py-4 rounded-2xl transition-all duration-250 hover:scale-[1.04] active:scale-[0.98] hover:shadow-xl hover:shadow-primary-500/30"
            aria-label="Open the live demo application"
          >
            <span>🎙️</span>
            Try Live Demo
            {/* Arrow slides right on hover — communicates forward navigation */}
            <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
          </Link>
          <a
            href="#features"
            className="inline-flex items-center gap-2 glass hover:bg-white/20 text-white font-semibold text-lg px-8 py-4 rounded-2xl transition-all duration-250"
          >
            Explore Features
            <span aria-hidden="true">↓</span>
          </a>
        </motion.div>

        {/* Camera illustration */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.6, ease: 'easeOut' }}
          className="mt-20 relative"
          aria-hidden="true"
        >
          <div className="relative inline-flex items-center justify-center">
            {/* Camera frame */}
            <div className="relative w-72 h-48 sm:w-96 sm:h-60 glass rounded-2xl overflow-hidden">
              {/* Scan line — only on the camera frame mock, appropriate */}
              <div className="scan-line" />
              {/* Grid overlay */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-px opacity-10">
                {[...Array(9)].map((_, i) => <div key={i} className="border border-white/30" />)}
              </div>
              {/* Center content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                {/* Eye icon — subtle breathe instead of float (more considered) */}
                <motion.div
                  animate={{ scale: [1, 1.06, 1], opacity: [0.9, 1, 0.9] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-4xl"
                >
                  👁️
                </motion.div>
                <div className="text-sm font-medium text-accent-300">Analyzing scene...</div>
                {/* Waveform — synchronized bars, not random pulse timing */}
                <div className="flex items-center gap-1" role="img" aria-label="Audio waveform">
                  {WAVEFORM_HEIGHTS.map((h, i) => (
                    <motion.div
                      key={i}
                      animate={{ scaleY: [1, h / 5, 1] }}
                      transition={{
                        duration: 0.8,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: i * 0.08,
                      }}
                      className="w-1 bg-accent-400 rounded-full origin-bottom"
                      style={{ height: `${h * 3}px` }}
                    />
                  ))}
                </div>
              </div>
              {/* Corner decorations */}
              <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-primary-400" />
              <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-primary-400" />
              <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-primary-400" />
              <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-primary-400" />
            </div>

            {/* Floating detection badges — kept but with consistent, gentle motion */}
            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -top-4 -right-4 glass px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-300"
            >
              ✓ Person detected
            </motion.div>
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
              className="absolute -bottom-4 -left-4 glass px-3 py-1.5 rounded-xl text-xs font-semibold text-accent-300"
            >
              🔊 Narrating...
            </motion.div>
          </div>
        </motion.div>
      </motion.div>

      {/* Scroll indicator — simpler, single entrance */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/40"
        aria-hidden="true"
      >
        <span className="text-xs font-medium tracking-wide">Scroll to explore</span>
        {/* Inner dot slides down — communicates scrollability clearly */}
        <div className="w-5 h-8 border-2 border-white/25 rounded-full flex items-start justify-center pt-1.5">
          <motion.div
            animate={{ y: [0, 10, 0], opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            className="w-1 h-2 bg-white/60 rounded-full"
          />
        </div>
      </motion.div>
    </section>
  );
}

// ─── Features Section ───────────────────────────────────────────────────────────
function FeaturesSection() {
  return (
    <section
      id="features"
      aria-label="Features"
      className="py-24 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-dark-850"
    >
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={fadeInUp}
          className="text-center mb-16"
        >
          <p className="text-primary-500 dark:text-primary-400 font-semibold text-sm uppercase tracking-widest mb-3">
            Four Powerful Modules
          </p>
          <h2 className="font-display font-bold text-4xl sm:text-5xl text-gray-900 dark:text-white mb-4">
            Everything You Need to{' '}
            <span className="text-gradient">Navigate Independently</span>
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-lg max-w-2xl mx-auto">
            From live scene narration to GPS guidance — all powered by free, open-source AI tools
            and optimized for real-world use.
          </p>
        </motion.div>

        {/* Feature cards — staggered reveal communicates there are 4 distinct tools */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={staggerContainer}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          role="list"
          aria-label="Features list"
        >
          {featureCards.map((card) => (
            <motion.article
              key={card.title}
              variants={fadeInUp}
              role="listitem"
              whileHover={{ y: -4, transition: { duration: 0.2, ease: 'easeOut' } }}
              className="group relative bg-white dark:bg-dark-800 rounded-2xl p-6 border border-gray-100 dark:border-white/5 cursor-default"
              style={{
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                transition: 'box-shadow 0.2s ease-out',
              }}
            >
              {/* Icon */}
              <div
                className={`w-14 h-14 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center text-2xl mb-5 shadow-md`}
                aria-hidden="true"
              >
                {card.icon}
              </div>

              {/* Content */}
              <h3 className="font-display font-bold text-xl text-gray-900 dark:text-white mb-2">
                {card.title}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                {card.description}
              </p>

              {/* Hover accent — single, minimal glow overlay */}
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ background: `linear-gradient(135deg, ${card.accent}, transparent)` }}
                aria-hidden="true"
              />
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── How It Works Section ───────────────────────────────────────────────────────
function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-label="How It Works"
      className="py-24 px-4 sm:px-6 lg:px-8 dark:bg-dark-900 bg-white"
    >
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={fadeInUp}
          className="text-center mb-16"
        >
          <p className="text-primary-500 dark:text-primary-400 font-semibold text-sm uppercase tracking-widest mb-3">
            Under the Hood
          </p>
          <h2 className="font-display font-bold text-4xl sm:text-5xl text-gray-900 dark:text-white">
            From Camera to{' '}
            <span className="text-gradient">Voice in Seconds</span>
          </h2>
        </motion.div>

        {/* Steps flow */}
        <div className="relative" role="list" aria-label="Processing steps">
          {/* Connecting line (desktop) */}
          <div
            className="hidden lg:block absolute top-[3.5rem] left-[12.5%] right-[12.5%] h-0.5 bg-gradient-to-r from-primary-500 via-accent-400 to-emerald-500"
            aria-hidden="true"
          />

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-60px' }}
            variants={staggerContainer}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8"
          >
            {steps.map((step, index) => (
              <motion.div
                key={step.label}
                variants={fadeInUp}
                role="listitem"
                className="flex flex-col items-center text-center"
              >
                {/* Step number + icon */}
                <div className="relative mb-5">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center text-2xl shadow-xl ring-4 ring-white dark:ring-dark-900 z-10 relative"
                    style={{ backgroundColor: step.color + '22', border: `2px solid ${step.color}` }}
                    aria-label={`Step ${index + 1}: ${step.label}`}
                  >
                    {step.icon}
                  </div>
                  {/* Step number badge */}
                  <div
                    className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: step.color }}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </div>
                </div>

                <h3 className="font-display font-bold text-lg text-gray-900 dark:text-white mb-2">
                  {step.label}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm">{step.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Tech badges */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeInUp}
          className="mt-16 flex flex-wrap justify-center gap-3"
          aria-label="Technologies used"
        >
          {[
            '🤗 Hugging Face BLIP',
            '⚡ TensorFlow.js COCO-SSD',
            '🗺️ OSRM Routing',
            '📍 Nominatim Geocoding',
            '🔊 Web Speech API',
          ].map((tech) => (
            <span
              key={tech}
              className="glass dark:glass-dark px-4 py-2 rounded-full text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {tech}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── CTA Section ────────────────────────────────────────────────────────────────
function CtaSection() {
  return (
    // Uses a single solid dark background instead of bg-gradient-animated (already used in hero)
    <section
      id="cta"
      aria-label="Call to action"
      className="py-24 px-4 sm:px-6 lg:px-8 bg-dark-900 dark:bg-dark-950"
    >
      <div className="max-w-4xl mx-auto text-center">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={staggerContainer}
        >
          <motion.p variants={fadeInUp} className="text-accent-300 font-semibold text-sm uppercase tracking-widest mb-4">
            Ready to Experience It?
          </motion.p>
          <motion.h2
            variants={fadeInUp}
            className="font-display font-bold text-5xl sm:text-6xl text-white mb-6 leading-tight"
          >
            Independence Through{' '}
            <span className="text-gradient">AI Vision</span>
          </motion.h2>
          <motion.p variants={fadeInUp} className="text-gray-300 text-xl mb-10 max-w-2xl mx-auto">
            No subscriptions. No proprietary lock-in. Just open-source AI working for
            everyone — completely free to run.
          </motion.p>
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/app"
              className="group inline-flex items-center gap-3 bg-white text-primary-700 font-bold text-xl px-10 py-5 rounded-2xl transition-all duration-250 hover:scale-[1.04] active:scale-[0.98] hover:shadow-xl"
              aria-label="Launch the Real-Time Scene Narrator application"
            >
              🎙️ Launch App
              <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 glass hover:bg-white/20 text-white font-semibold text-xl px-10 py-5 rounded-2xl transition-all duration-250"
            >
              ⭐ View on GitHub
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer
      className="bg-gray-900 dark:bg-dark-950 text-gray-400 py-12 px-4 sm:px-6 lg:px-8"
      role="contentinfo"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xs">
            👁
          </div>
          <span className="font-display font-semibold text-white">Scene Narrator</span>
        </div>
        <p className="text-sm text-center">
          Built with ❤️ for accessibility · Powered by Hugging Face, OSRM, and TensorFlow.js
        </p>
        <p className="text-sm">Open Source · Free to Use</p>
      </div>
    </footer>
  );
}

// ─── Landing Page ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main id="main-content">
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
