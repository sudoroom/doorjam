/* doorjam_arduino.ino
 * door opener closer program for Sudoroom / TheOmni
 * works with meatspace_firewall
 * https://github.com/sudoroom/doorjam
 * lisence:  GPL V3
 * by jerkey
 *
 * it runs a DC motor for a few seconds to lock or unlock the door,
 * and it watches the current so it can stop if the motor encounters a hard stop.
 */

// http://arduino.cc/en/Main/ArduinoMotorShieldR3

//#include <Adafruit_NeoPixel.h>

#define SPEAKER 5 // a beeper connected to pin 5 for happy/sad sounds
#define LED_DATA 2 // adafruit neopixel ws2811 ws2812 style LEDs (six)

#define SADTONE 200 // sad tone frequency
#define SADTIME 1000 // sadtone time in milliseconds
#define HAPPYTONE 1000  // happy tone frequency
#define HAPPYTIME 1000  // happy tone time in milliseconds

#define CHA_DIR 12
#define CHA_PWM 3
#define CHA_BRK 9
#define CHA_SENSE A0
#define CHB_DIR 13
#define CHB_PWM 11
#define CHB_BRK 8
#define CHB_SENSE A1

#define OPEN_TIME 8000 // milliseconds how long to run the motor
#define OPEN_CURRENTMAX 940 // analogRead() value, not amps or anything
#define CLOSE_CURRENTMAX 940 // change this to 70 to be able to trip it by hand
#define MOTOR_START_TIME 150 // milliseconds before we start looking at current draw
#define OPEN_RETRACT_TIME 500 // milliseconds to reverse motor after hitting current limit
#define CLOSE_RETRACT_TIME 500 // milliseconds to reverse motor after hitting current limit

#define UNLATCH_DETECT_PIN 4

#define AVG_CYCLES 50.0 // how many times to read analogRead and average reading

//Adafruit_NeoPixel strip = Adafruit_NeoPixel(6, LED_DATA, NEO_GRB + NEO_KHZ800);

#define VOLTCOEFF 0.02704 // 2.2k and 10k ohm resistor divider
#define VOLT_SENSE A5 // pin where voltage divider is connected
float voltage = 0;

void reportVoltage() {
  Serial.print("voltage ");
  unsigned long voltAdder = 0;
  for (int i = 0; i < AVG_CYCLES; i++) {
    voltAdder += analogRead(VOLT_SENSE);
  }
  voltage = (float)voltAdder / (float)AVG_CYCLES * VOLTCOEFF;
  Serial.println(voltage,2);
}

void happyTone() {
  tone (SPEAKER, HAPPYTONE, HAPPYTIME);
}

void sadTone() {
  tone (SPEAKER, SADTONE, SADTIME);
}


void doorOpen() {
  Serial.println("opening door!");
  happyTone(); // tone is not blocking  
  digitalWrite(CHB_DIR,LOW);
  digitalWrite(CHB_PWM,HIGH); // turn motor on
  unsigned long now = millis();
  boolean overcurrent = false;
  while (millis() - now < OPEN_TIME && !overcurrent) {
    float current = 0;
    for (int i = 0; i < AVG_CYCLES; i++) current += analogRead(CHB_SENSE); // read a bunch of times
    current = current / AVG_CYCLES; // get the average current reading
    if ((millis() - now > MOTOR_START_TIME) && (current > OPEN_CURRENTMAX)) {
      overcurrent = true;
      Serial.println("overcurrent!");
    }
  }
  digitalWrite(CHB_PWM,LOW); // turn motor off
}

void setup() {
  Serial.begin(9600);
  Serial.println("Hello world, this is the door");
  pinMode(CHA_DIR,OUTPUT);
  pinMode(CHA_PWM,OUTPUT);
  pinMode(CHA_BRK,OUTPUT);
  pinMode(CHB_DIR,OUTPUT);
  pinMode(CHB_PWM,OUTPUT);
  pinMode(CHB_BRK,OUTPUT);
  digitalWrite(UNLATCH_DETECT_PIN, HIGH); // enable internal pull-up resistor
  pinMode(SPEAKER,OUTPUT);
}

void loop() {
  if (Serial.available()) {  // if a byte appears on the serial port
    byte inByte = Serial.read();
    if (inByte == 'o') doorOpen();
    if (inByte == 'c') {
      Serial.println();
      if (digitalRead(UNLATCH_DETECT_PIN)) {
        Serial.println("Latched");
      } else Serial.println("Unlatched");
    }

    if (inByte == 'h') happyTone(); // use this when?
    if (inByte == 's') sadTone(); // use this when a card is rejected
    if (inByte == 'b') reportVoltage();
    while (Serial.available()) { // read all bytes in the buffer until the the buffer is empty
      byte throwAway = Serial.read();
    }
  }
}
