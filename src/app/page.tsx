import Link from "next/link";
import { BookOpen, Trophy, Swords, Target, Users, Zap, Star, CheckCircle } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-2xl font-black text-primary">EthioLearn</span>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-text-secondary hover:text-primary">Sign In</Link>
            <Link href="/register" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">Get Started</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-24">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
          <Star className="h-4 w-4" />
          Ethiopia's #1 Student Learning Platform
        </div>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-text-primary sm:text-6xl">
          Learn Smarter,<br />
          <span className="text-primary">Earn Rewards</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
          EthioLearn turns studying into a game. Take quizzes, battle classmates, climb the leaderboard, and earn real rewards — all aligned with the Ethiopian curriculum.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link href="/register" className="w-full rounded-xl bg-primary px-8 py-4 text-lg font-bold text-white hover:bg-primary/90 sm:w-auto">
            Start Learning Free →
          </Link>
          <Link href="/login" className="w-full rounded-xl border border-border px-8 py-4 text-lg font-semibold text-text-primary hover:bg-gray-50 sm:w-auto">
            Sign In
          </Link>
        </div>
        {/* Stats row */}
        <div className="mt-16 grid grid-cols-3 gap-8 border-t border-border pt-12">
          {[
            { label: "Questions", value: "10,000+" },
            { label: "Subjects", value: "10+" },
            { label: "Grades", value: "7-12" },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-3xl font-black text-primary">{s.value}</div>
              <div className="mt-1 text-sm text-text-secondary">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section className="bg-surface py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-2 text-center text-3xl font-bold text-text-primary">Everything you need to excel</h2>
          <p className="mb-12 text-center text-text-secondary">Built for Ethiopian students, Grade 7-12</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: BookOpen, title: "Curriculum-Aligned Quizzes", desc: "MCQ questions mapped to Biology, Mathematics, Physics, Chemistry, and more — written for the Ethiopian curriculum." },
              { icon: Swords, title: "Group Battle Mode", desc: "Challenge classmates to real-time quiz battles. Answer faster and smarter to climb to the top of the scoreboard." },
              { icon: Trophy, title: "Leaderboard & Rankings", desc: "See where you stand among your class, grade, and school. Weekly champions earn bonus rewards." },
              { icon: Target, title: "Adaptive Difficulty", desc: "Choose Easy, Medium, or Hard questions. The system tracks your progress and helps you focus on weak areas." },
              { icon: Zap, title: "XP & Level System", desc: "Earn experience points with every quiz. Level up, maintain daily streaks, and unlock new achievement badges." },
              { icon: Star, title: "Rewards & Recognition", desc: "Redeem your points for real rewards — stationery, books, vouchers, and more offered by your school." },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-background p-6">
                <div className="mb-4 w-fit rounded-lg bg-primary/10 p-3">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 font-bold text-text-primary">{f.title}</h3>
                <p className="text-sm text-text-secondary">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-12 text-center text-3xl font-bold text-text-primary">How it works</h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {[
            { step: "1", title: "Create your account", desc: "Sign up with Google, Telegram, or your Ethiopian phone number — quick and easy." },
            { step: "2", title: "Take quizzes & battle", desc: "Pick a subject, chapter, and difficulty. Answer questions to earn points and beat your classmates." },
            { step: "3", title: "Earn rewards", desc: "Accumulate points, level up, and redeem them for real prizes offered by your school." },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-black text-white">
                {s.step}
              </div>
              <h3 className="mb-2 font-bold text-text-primary">{s.title}</h3>
              <p className="text-sm text-text-secondary">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Subjects */}
      <section className="bg-surface py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="mb-8 text-center text-2xl font-bold text-text-primary">Subjects covered</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {["Biology", "Mathematics", "Physics", "Chemistry", "English", "Amharic", "History", "Geography"].map((s) => (
              <span key={s} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-text-primary">
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <div className="rounded-2xl bg-primary px-8 py-12">
          <h2 className="text-3xl font-black text-white">Ready to start learning?</h2>
          <p className="mt-3 text-primary-light text-white/80">Join thousands of Ethiopian students already using EthioLearn.</p>
          <Link href="/register" className="mt-8 inline-block rounded-xl bg-white px-8 py-4 text-lg font-bold text-primary hover:bg-white/90">
            Create Free Account →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-surface py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-text-muted">
          <p className="font-bold text-primary">EthioLearn</p>
          <p className="mt-1">© 2026 EthioLearn. Built for Ethiopian students.</p>
        </div>
      </footer>
    </div>
  );
}
